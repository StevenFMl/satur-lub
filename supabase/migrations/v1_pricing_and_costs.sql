-- =========================================================================
-- V1 PRICING & COSTS · Consolidación de precios por tiers, CPP, snapshots y
-- protecciones de inventario. Idempotente.
--
-- Aplica DESPUÉS de:
--   db.sql
--   stock_adjustment.sql
--   kardex_shield_and_tenant_fix.sql
--   tax_domain_migration.sql
--
-- Decisiones congeladas:
--  - product_prices es la fuente de verdad del precio activo (fila vigente
--    = valid_to IS NULL). product_price_history acumula auditoría.
--  - products.default_price es caché de lectura del tier default del tenant,
--    sincronizado por trigger desde product_prices.
--  - products.average_cost (CPP) y products.last_purchase_cost se mantienen
--    en receive_purchase_order; sale_items.unit_cost guarda snapshot al
--    vender (preparado para flujo de ventas, lo llena la futura RPC).
--  - cancel_purchase_order valida stock disponible antes de revertir.
--  - inventory_balances.quantity_on_hand >= 0 a nivel de constraint.
-- =========================================================================

BEGIN;

-- =========================================================================
-- 1. NUEVAS COLUMNAS
-- =========================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS default_price        numeric(12,2),
  ADD COLUMN IF NOT EXISTS average_cost         numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_purchase_cost   numeric(14,4);

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS default_price_tier_id uuid;

-- Backfill: average_cost de productos existentes parte del cost_price.
UPDATE public.products
   SET average_cost = COALESCE(cost_price, 0)
 WHERE average_cost = 0 AND COALESCE(cost_price, 0) > 0;

-- FKs simples sobre la columna nuleable únicamente.
--
-- NOTA: Una FK compuesta (id, default_price_tier_id) con ON DELETE SET NULL
-- intentaría poner a NULL TODOS los campos del lado referenciante — incluyendo
-- tenants.id (PK NOT NULL) o business_partners.tenant_id (NOT NULL), lo que
-- falla en Postgres. El aislamiento por tenant lo garantizan RLS y las RPCs,
-- el mismo patrón usado en todo el resto del schema.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_default_price_tier_fk'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_default_price_tier_fk
      FOREIGN KEY (default_price_tier_id)
      REFERENCES public.price_tiers (id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.business_partners
  ADD COLUMN IF NOT EXISTS default_price_tier_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'business_partners_default_price_tier_fk'
  ) THEN
    ALTER TABLE public.business_partners
      ADD CONSTRAINT business_partners_default_price_tier_fk
      FOREIGN KEY (default_price_tier_id)
      REFERENCES public.price_tiers (id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14,4);

-- Fecha real de la factura del proveedor (distinta de created_at, que es el
-- timestamp de carga en sistema). Permite comparativas históricas por proveedor.
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS purchase_date date;

-- =========================================================================
-- 2. PROTECCIÓN STOCK NO NEGATIVO
-- =========================================================================

-- Sanea cualquier saldo negativo previo (ajuste defensivo a 0 — los registros
-- históricos en inventory_movements quedan intactos para trazabilidad).
UPDATE public.inventory_balances
   SET quantity_on_hand = 0,
       updated_at = now()
 WHERE quantity_on_hand < 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_inventory_balances_nonneg'
  ) THEN
    ALTER TABLE public.inventory_balances
      ADD CONSTRAINT chk_inventory_balances_nonneg
      CHECK (quantity_on_hand >= 0);
  END IF;
END $$;

-- =========================================================================
-- 3. ÍNDICE ÚNICO PARCIAL DE PRECIOS VIGENTES
-- =========================================================================
-- Garantiza que solo exista una fila vigente (valid_to IS NULL) por
-- (tenant_id, product_id, price_tier_id). El historial cerrado (valid_to
-- != NULL) puede tener N filas.

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_prices_active
  ON public.product_prices (tenant_id, product_id, price_tier_id)
  WHERE valid_to IS NULL;

-- =========================================================================
-- 4. VISTA DE PRECIOS ACTIVOS
-- =========================================================================

CREATE OR REPLACE VIEW public.v_product_active_prices AS
SELECT
  pp.tenant_id,
  pp.product_id,
  pp.price_tier_id,
  pt.code        AS tier_code,
  pt.name        AS tier_name,
  pp.unit_price,
  pp.valid_from
FROM public.product_prices pp
JOIN public.price_tiers pt
  ON pt.tenant_id = pp.tenant_id
 AND pt.id = pp.price_tier_id
WHERE pp.valid_to IS NULL;

GRANT SELECT ON public.v_product_active_prices TO authenticated;

-- =========================================================================
-- 5. SEED DE TIERS POR DEFAULT (PUBLICO / MAYORISTA / DISTRIBUIDOR)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.seed_default_price_tiers(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_publico_id uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;

  INSERT INTO public.price_tiers (tenant_id, code, name)
  VALUES
    (p_tenant_id, 'PUBLICO',      'Público'),
    (p_tenant_id, 'MAYORISTA',    'Mayorista'),
    (p_tenant_id, 'DISTRIBUIDOR', 'Distribuidor')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT id INTO v_publico_id
    FROM public.price_tiers
   WHERE tenant_id = p_tenant_id
     AND code = 'PUBLICO';

  UPDATE public.tenants
     SET default_price_tier_id = v_publico_id
   WHERE id = p_tenant_id
     AND default_price_tier_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_default_price_tiers(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.seed_default_price_tiers(uuid) TO authenticated;

-- Backfill: aplicar a todos los tenants existentes.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_default_price_tiers(r.id);
  END LOOP;
END $$;

-- =========================================================================
-- 6. RPC set_product_tier_price · upsert vigente con cierre + historia
-- =========================================================================

CREATE OR REPLACE FUNCTION public.set_product_tier_price(
  p_tenant_id  uuid,
  p_product_id uuid,
  p_tier_code  text,
  p_unit_price numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_tier_id   uuid;
  v_old_price numeric(12,2);
  v_old_id    uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id y product_id son requeridos';
  END IF;
  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Precio inválido';
  END IF;

  SELECT id INTO v_tier_id
    FROM public.price_tiers
   WHERE tenant_id = p_tenant_id
     AND code      = p_tier_code;

  IF v_tier_id IS NULL THEN
    RAISE EXCEPTION 'Tier % no existe en este tenant', p_tier_code;
  END IF;

  -- Candado optimista sobre la fila vigente (si existe)
  SELECT id, unit_price
    INTO v_old_id, v_old_price
    FROM public.product_prices
   WHERE tenant_id    = p_tenant_id
     AND product_id   = p_product_id
     AND price_tier_id = v_tier_id
     AND valid_to IS NULL
   FOR UPDATE;

  -- Idempotencia: mismo precio → no-op
  IF v_old_price IS NOT NULL AND v_old_price = round(p_unit_price, 2) THEN
    RETURN;
  END IF;

  -- Cerrar fila vigente (si la había)
  IF v_old_id IS NOT NULL THEN
    UPDATE public.product_prices
       SET valid_to = now()
     WHERE id = v_old_id;
  END IF;

  -- Insertar nueva fila vigente
  INSERT INTO public.product_prices (
    tenant_id, product_id, price_tier_id, unit_price
  ) VALUES (
    p_tenant_id, p_product_id, v_tier_id, round(p_unit_price, 2)
  );

  -- Auditoría (changed_by puede ser NULL si la llamada no viene de un user
  -- autenticado, p.ej. backfill / RPC interna).
  INSERT INTO public.product_price_history (
    tenant_id, product_id, price_tier_id,
    old_price, new_price, changed_by
  ) VALUES (
    p_tenant_id, p_product_id, v_tier_id,
    v_old_price, round(p_unit_price, 2),
    CASE
      WHEN v_user_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.tenant_memberships
         WHERE tenant_id = p_tenant_id AND user_id = v_user_id
      ) THEN v_user_id
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_tier_price(uuid, uuid, text, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.set_product_tier_price(uuid, uuid, text, numeric) TO authenticated;

-- =========================================================================
-- 7. TRIGGER · Sincroniza products.default_price con el tier default vigente
-- =========================================================================

CREATE OR REPLACE FUNCTION public.sync_product_default_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_tier uuid;
  v_active_price numeric(12,2);
BEGIN
  -- Solo nos interesan filas vigentes del tier default del tenant.
  SELECT default_price_tier_id INTO v_default_tier
    FROM public.tenants
   WHERE id = COALESCE(NEW.tenant_id, OLD.tenant_id);

  IF v_default_tier IS NULL THEN
    RETURN NULL;
  END IF;

  -- Si la fila afectada NO es del tier default, no hay nada que sincronizar.
  IF COALESCE(NEW.price_tier_id, OLD.price_tier_id) <> v_default_tier THEN
    RETURN NULL;
  END IF;

  -- Recalcular: lee la fila vigente actual del tier default (puede haber
  -- cambiado por insert nuevo o por update de valid_to).
  SELECT unit_price INTO v_active_price
    FROM public.product_prices
   WHERE tenant_id    = COALESCE(NEW.tenant_id, OLD.tenant_id)
     AND product_id   = COALESCE(NEW.product_id, OLD.product_id)
     AND price_tier_id = v_default_tier
     AND valid_to IS NULL
   LIMIT 1;

  UPDATE public.products
     SET default_price = v_active_price
   WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
     AND id        = COALESCE(NEW.product_id, OLD.product_id)
     AND default_price IS DISTINCT FROM v_active_price;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_prices_sync_default ON public.product_prices;
CREATE TRIGGER trg_product_prices_sync_default
AFTER INSERT OR UPDATE OF unit_price, valid_to ON public.product_prices
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_default_price();

-- =========================================================================
-- 8. BACKFILL · product_prices PUBLICO para productos preexistentes
-- =========================================================================
-- Estrategia: para cada producto sin precio vigente PUBLICO, crear uno con
-- unit_price = COALESCE(cost_price, 0). El usuario lo va a corregir desde
-- la UI; este valor evita rompimientos donde la UI espere un precio.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.tenant_id, p.id AS product_id, COALESCE(p.cost_price, 0) AS price
      FROM public.products p
      JOIN public.price_tiers t
        ON t.tenant_id = p.tenant_id AND t.code = 'PUBLICO'
      LEFT JOIN public.product_prices pp
        ON pp.tenant_id    = p.tenant_id
       AND pp.product_id   = p.id
       AND pp.price_tier_id = t.id
       AND pp.valid_to IS NULL
     WHERE pp.id IS NULL
  LOOP
    PERFORM public.set_product_tier_price(
      r.tenant_id, r.product_id, 'PUBLICO', r.price
    );
  END LOOP;
END $$;

-- =========================================================================
-- 9. REFACTOR receive_purchase_order · CPP + last_purchase_cost
-- =========================================================================
-- Misma firma que tax_domain_migration.sql para que el client no cambie.
-- Sumamos: cálculo de costo promedio ponderado por producto (a nivel
-- tenant, sumando todas las bodegas) usando unit_cost neto recibido.

-- Firma vieja (14 params) — la eliminamos para reemplazarla con 15 params.
DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, uuid, uuid, text, text, date, text, jsonb, numeric, boolean, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_tenant_id        uuid,
  p_supplier_id      uuid,
  p_warehouse_id     uuid,
  p_payment_method   text,
  p_payment_status   text,
  p_payment_due_date date,
  p_purchase_date    date,    -- fecha real de la factura del proveedor
  p_notes            text,
  p_items            jsonb,
  p_tax_rate         numeric,
  p_is_tax_inclusive boolean,
  p_subtotal         numeric,
  p_tax_amount       numeric,
  p_grand_total      numeric,
  p_other_charges    numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_po_id      uuid;
  v_item       jsonb;
  v_qty        numeric(12,4);
  v_unit_cost  numeric(12,4);
  v_is_taxable boolean;
  v_line_total numeric(12,2);
  v_product_id uuid;
  v_pay_status text;
  v_stock_total numeric(14,4);
  v_avg_old    numeric(14,4);
  v_avg_new    numeric(14,4);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Debe incluir al menos un ítem';
  END IF;

  IF p_payment_method NOT IN ('cash', 'transfer', 'credit') THEN
    RAISE EXCEPTION 'Método de pago inválido';
  END IF;

  IF p_tax_rate IS NULL OR p_tax_rate < 0 OR p_tax_rate > 100 THEN
    RAISE EXCEPTION 'Tasa de IVA inválida';
  END IF;

  IF p_subtotal IS NULL OR p_subtotal < 0
     OR p_tax_amount IS NULL OR p_tax_amount < 0
     OR p_grand_total IS NULL OR p_grand_total < 0 THEN
    RAISE EXCEPTION 'Totales fiscales inválidos';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_partners
     WHERE id = p_supplier_id
       AND tenant_id = p_tenant_id
       AND partner_type = 'supplier'
       AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Proveedor inválido';
  END IF;

  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouses
     WHERE id = p_warehouse_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Bodega inválida';
  END IF;

  v_pay_status := CASE
    WHEN p_payment_method IN ('cash', 'transfer') THEN COALESCE(p_payment_status, 'paid')
    ELSE COALESCE(p_payment_status, 'pending')
  END;

  INSERT INTO public.purchase_orders (
    tenant_id, supplier_id, warehouse_id,
    subtotal, tax_total, total,
    tax_rate, is_tax_inclusive, tax_amount, grand_total, other_charges,
    status, notes, created_by,
    payment_method, payment_status, payment_due_date,
    purchase_date
  ) VALUES (
    p_tenant_id, p_supplier_id, p_warehouse_id,
    p_subtotal, p_tax_amount, p_grand_total,
    p_tax_rate, p_is_tax_inclusive, p_tax_amount, p_grand_total, p_other_charges,
    'received', p_notes, v_user_id,
    p_payment_method, v_pay_status,
    CASE WHEN p_payment_method = 'credit' THEN p_payment_due_date ELSE NULL END,
    p_purchase_date
  )
  RETURNING id INTO v_po_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'quantity')::numeric;
    v_unit_cost  := (v_item->>'unit_cost')::numeric;
    v_is_taxable := COALESCE((v_item->>'is_taxable')::boolean, true);

    IF v_qty IS NULL OR v_qty <= 0 OR v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Cantidad y costo deben ser > 0';
    END IF;

    v_line_total := round(v_qty * v_unit_cost, 2);

    IF NOT EXISTS (
      SELECT 1 FROM public.products
       WHERE id = v_product_id AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'Producto inválido (%)', v_product_id;
    END IF;

    INSERT INTO public.purchase_order_items (
      tenant_id, purchase_order_id, product_id,
      quantity, unit_cost, line_total, is_taxable
    ) VALUES (
      p_tenant_id, v_po_id, v_product_id,
      v_qty, v_unit_cost, v_line_total, v_is_taxable
    );

    INSERT INTO public.inventory_movements (
      tenant_id, warehouse_id, product_id,
      movement_type, quantity, unit_cost, reason,
      reference_type, reference_id, performed_by_user_id, direction
    ) VALUES (
      p_tenant_id, p_warehouse_id, v_product_id,
      'purchase', v_qty, v_unit_cost, 'Recepción de compra',
      'purchase_order', v_po_id, v_user_id, 1
    );

    -- ── CPP (Costo Promedio Ponderado) ───────────────────────────────
    -- 1. Bloqueo la fila del producto para evitar carrera con ventas
    --    o cancelaciones concurrentes que también muevan stock.
    -- 2. Sumo stock total del producto (todas las bodegas del tenant).
    -- 3. Calculo nuevo promedio.
    -- 4. Persisto average_cost y last_purchase_cost.
    PERFORM 1
       FROM public.products
      WHERE id = v_product_id AND tenant_id = p_tenant_id
        FOR UPDATE;

    SELECT COALESCE(SUM(quantity_on_hand), 0)
      INTO v_stock_total
      FROM public.inventory_balances
     WHERE tenant_id = p_tenant_id AND product_id = v_product_id;

    SELECT COALESCE(average_cost, 0)
      INTO v_avg_old
      FROM public.products
     WHERE id = v_product_id AND tenant_id = p_tenant_id;

    IF (v_stock_total + v_qty) <= 0 THEN
      v_avg_new := v_unit_cost;
    ELSE
      v_avg_new := ((v_stock_total * v_avg_old) + (v_qty * v_unit_cost))
                 / (v_stock_total + v_qty);
    END IF;

    UPDATE public.products
       SET average_cost       = round(v_avg_new, 4),
           last_purchase_cost = round(v_unit_cost, 4),
           last_supplier_id   = p_supplier_id
     WHERE id = v_product_id AND tenant_id = p_tenant_id;

    -- ── Balance físico ───────────────────────────────────────────────
    IF p_warehouse_id IS NOT NULL THEN
      INSERT INTO public.inventory_balances (
        tenant_id, warehouse_id, product_id, quantity_on_hand
      ) VALUES (
        p_tenant_id, p_warehouse_id, v_product_id, v_qty
      )
      ON CONFLICT (tenant_id, warehouse_id, product_id) DO UPDATE
        SET quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
            updated_at = now();
    END IF;
  END LOOP;

  RETURN v_po_id;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, uuid, uuid, text, text, date, date, text, jsonb, numeric, boolean, numeric, numeric, numeric, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, uuid, uuid, text, text, date, date, text, jsonb, numeric, boolean, numeric, numeric, numeric, numeric) TO authenticated;

-- =========================================================================
-- 10. REFACTOR cancel_purchase_order · validación de stock disponible
-- =========================================================================
-- Mantiene firma (p_tenant_id, p_po_id). Antes de revertir, verifica que
-- haya stock suficiente en la bodega. Si no, falla con mensaje funcional
-- (la app puede mostrarlo al usuario).

DROP FUNCTION IF EXISTS public.cancel_purchase_order(uuid, uuid);

CREATE OR REPLACE FUNCTION public.cancel_purchase_order(
  p_tenant_id uuid,
  p_po_id     uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_warehouse_id uuid;
  v_status       text;
  v_item         record;
  v_balance      numeric(12,2);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;

  SELECT status, warehouse_id
    INTO v_status, v_warehouse_id
    FROM public.purchase_orders
   WHERE id = p_po_id
     AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;

  IF v_status <> 'received' THEN
    RAISE EXCEPTION 'Solo se pueden anular órdenes en estado "received". Estado actual: %', v_status;
  END IF;

  -- ── PREVALIDACIÓN: stock suficiente para revertir cada ítem ──────────
  -- Si la bodega no fue asignada, no hay balance que validar (la compra
  -- no afectó stock físico).
  IF v_warehouse_id IS NOT NULL THEN
    FOR v_item IN
      SELECT product_id, quantity
        FROM public.purchase_order_items
       WHERE purchase_order_id = p_po_id
         AND tenant_id = p_tenant_id
    LOOP
      SELECT COALESCE(quantity_on_hand, 0)
        INTO v_balance
        FROM public.inventory_balances
       WHERE tenant_id    = p_tenant_id
         AND warehouse_id = v_warehouse_id
         AND product_id   = v_item.product_id;

      IF v_balance < v_item.quantity THEN
        RAISE EXCEPTION 'Stock insuficiente para anular: producto % requiere % unidades pero hay %',
          v_item.product_id, v_item.quantity, v_balance;
      END IF;
    END LOOP;
  END IF;

  -- ── Marcar como cancelada ────────────────────────────────────────────
  UPDATE public.purchase_orders
     SET status = 'cancelled'
   WHERE id = p_po_id
     AND tenant_id = p_tenant_id;

  -- ── Revertir cada ítem (movimiento + balance) ────────────────────────
  FOR v_item IN
    SELECT product_id, quantity, unit_cost
      FROM public.purchase_order_items
     WHERE purchase_order_id = p_po_id
       AND tenant_id = p_tenant_id
  LOOP
    INSERT INTO public.inventory_movements (
      tenant_id, warehouse_id, product_id,
      movement_type, quantity, unit_cost, reason,
      reference_type, reference_id, performed_by_user_id, direction
    ) VALUES (
      p_tenant_id, v_warehouse_id, v_item.product_id,
      'purchase_cancel', v_item.quantity, v_item.unit_cost,
      'Anulación de compra',
      'purchase_order', p_po_id, v_user_id, -1
    );

    IF v_warehouse_id IS NOT NULL THEN
      UPDATE public.inventory_balances
         SET quantity_on_hand = quantity_on_hand - v_item.quantity,
             updated_at = now()
       WHERE tenant_id    = p_tenant_id
         AND warehouse_id = v_warehouse_id
         AND product_id   = v_item.product_id;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_purchase_order(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(uuid, uuid) TO authenticated;

COMMIT;

-- =========================================================================
-- POST-CHECK opcional (correr manualmente si quieres verificar):
--
--   SELECT id, business_name, default_price_tier_id FROM tenants;
--   SELECT tenant_id, code, name FROM price_tiers ORDER BY tenant_id, code;
--   SELECT count(*) FROM v_product_active_prices;
--   SELECT id, name, default_price, average_cost, last_purchase_cost
--     FROM products LIMIT 20;
-- =========================================================================
