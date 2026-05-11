-- ============================================================
-- v8_purchase_bonus.sql
--
-- Agrega soporte para unidades bonificadas/regaladas en compras.
--
-- Estrategia elegida: Opción B — una sola línea por producto con
-- quantity_bonus separado.
--
-- Ventajas vs Opción A (múltiples líneas):
--   · Auditoría clara: "12 pagadas + 3 bonificadas = 15 recibidas"
--   · Costo efectivo visible por línea: $120/15 = $8.00
--   · CPP correcto: promedia el costo efectivo sobre las 15 unidades
--   · Sin líneas duplicadas confusas en el detalle de compra
--   · Retrocompatible: quantity_bonus = 0 en registros anteriores
--
-- Costo efectivo:
--   effective_unit_cost = line_total / (quantity + quantity_bonus)
--   CPP usa effective_unit_cost × qty_received (no unit_cost × qty_paid)
--
-- last_purchase_cost sigue siendo el precio negociado (sin incluir bonus)
-- porque es la referencia para la próxima sugerencia de compra.
-- ============================================================

BEGIN;

-- ── 1. Nueva columna en purchase_order_items ─────────────────

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS quantity_bonus numeric(12,4) NOT NULL DEFAULT 0
    CHECK (quantity_bonus >= 0);

-- ── 2. receive_purchase_order · soporte para quantity_bonus ──

DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, uuid, uuid, text, text, date, date, text, jsonb, numeric, boolean, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_tenant_id        uuid,
  p_supplier_id      uuid,
  p_warehouse_id     uuid,
  p_payment_method   text,
  p_payment_status   text,
  p_payment_due_date date,
  p_purchase_date    date,
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
  v_user_id         uuid := auth.uid();
  v_po_id           uuid;
  v_item            jsonb;
  v_product_id      uuid;
  v_qty_paid        numeric(12,4);
  v_qty_bonus       numeric(12,4);
  v_qty_received    numeric(12,4);
  v_unit_cost       numeric(12,4);
  v_effective_cost  numeric(14,4);
  v_is_taxable      boolean;
  v_line_total      numeric(12,2);
  v_pay_status      text;
  v_stock_total     numeric(14,4);
  v_avg_old         numeric(14,4);
  v_avg_new         numeric(14,4);
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id es requerido'; END IF;

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
     WHERE id = p_supplier_id AND tenant_id = p_tenant_id
       AND partner_type = 'supplier' AND is_active = true
  ) THEN RAISE EXCEPTION 'Proveedor inválido'; END IF;

  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.warehouses
     WHERE id = p_warehouse_id AND tenant_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'Bodega inválida'; END IF;

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

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id  := (v_item->>'product_id')::uuid;
    v_qty_paid    := (v_item->>'quantity')::numeric;
    v_qty_bonus   := COALESCE(NULLIF(trim(COALESCE(v_item->>'quantity_bonus', '')), '')::numeric, 0);
    v_unit_cost   := (v_item->>'unit_cost')::numeric;
    v_is_taxable  := COALESCE((v_item->>'is_taxable')::boolean, true);

    IF v_qty_paid IS NULL OR v_qty_paid <= 0 THEN
      RAISE EXCEPTION 'Cantidad pagada debe ser > 0';
    END IF;
    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Costo unitario inválido';
    END IF;
    IF v_qty_bonus < 0 THEN
      RAISE EXCEPTION 'Cantidad bonificada no puede ser negativa';
    END IF;

    v_qty_received := v_qty_paid + v_qty_bonus;
    -- line_total: solo las unidades pagadas generan costo fiscal
    v_line_total   := round(v_qty_paid * v_unit_cost, 2);

    -- Costo efectivo: lo que realmente costó cada unidad recibida
    -- Ej: $120 / 15 = $8.00 (no $10.00)
    IF v_qty_received > 0 THEN
      v_effective_cost := round(v_line_total / v_qty_received, 4);
    ELSE
      v_effective_cost := v_unit_cost;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.products
       WHERE id = v_product_id AND tenant_id = p_tenant_id
    ) THEN RAISE EXCEPTION 'Producto inválido (%)', v_product_id; END IF;

    INSERT INTO public.purchase_order_items (
      tenant_id, purchase_order_id, product_id,
      quantity, quantity_bonus, unit_cost, line_total, is_taxable
    ) VALUES (
      p_tenant_id, v_po_id, v_product_id,
      v_qty_paid, v_qty_bonus, v_unit_cost, v_line_total, v_is_taxable
    );

    -- Movimiento de inventario usa la cantidad total recibida y costo efectivo
    INSERT INTO public.inventory_movements (
      tenant_id, warehouse_id, product_id,
      movement_type, quantity, unit_cost, reason,
      reference_type, reference_id, performed_by_user_id, direction
    ) VALUES (
      p_tenant_id, p_warehouse_id, v_product_id,
      'purchase', v_qty_received, v_effective_cost, 'Recepción de compra',
      'purchase_order', v_po_id, v_user_id, 1
    );

    -- ── CPP (Costo Promedio Ponderado) ───────────────────────────────
    -- Usa costo efectivo × qty recibida (no costo pagado × qty pagada)
    -- Así el CPP refleja correctamente el costo real por unidad almacenada.
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

    IF (v_stock_total + v_qty_received) <= 0 THEN
      v_avg_new := v_effective_cost;
    ELSE
      v_avg_new := ((v_stock_total * v_avg_old) + (v_qty_received * v_effective_cost))
                 / (v_stock_total + v_qty_received);
    END IF;

    UPDATE public.products
       SET average_cost       = round(v_avg_new, 4),
           -- last_purchase_cost = precio negociado (sin bonus), referencia para próxima compra
           last_purchase_cost = round(v_unit_cost, 4),
           last_supplier_id   = p_supplier_id
     WHERE id = v_product_id AND tenant_id = p_tenant_id;

    -- ── Balance físico ───────────────────────────────────────────────
    IF p_warehouse_id IS NOT NULL THEN
      INSERT INTO public.inventory_balances (
        tenant_id, warehouse_id, product_id, quantity_on_hand
      ) VALUES (
        p_tenant_id, p_warehouse_id, v_product_id, v_qty_received
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

-- ── 3. cancel_purchase_order · revierte qty pagada + bonificada ──
-- Retrocompatible: quantity_bonus = 0 en órdenes anteriores → misma cantidad.

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
  v_user_id        uuid := auth.uid();
  v_warehouse_id   uuid;
  v_status         text;
  v_item           record;
  v_balance        numeric(12,2);
  v_qty_received   numeric(12,4);
  v_effective_cost numeric(14,4);
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario no autenticado'; END IF;
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id es requerido'; END IF;

  SELECT status, warehouse_id
    INTO v_status, v_warehouse_id
    FROM public.purchase_orders
   WHERE id = p_po_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Orden de compra no encontrada'; END IF;
  IF v_status <> 'received' THEN
    RAISE EXCEPTION 'Solo se pueden anular órdenes en estado "received". Estado actual: %', v_status;
  END IF;

  -- ── Prevalidación: stock suficiente para revertir cada ítem ──────────
  IF v_warehouse_id IS NOT NULL THEN
    FOR v_item IN
      SELECT product_id, quantity, COALESCE(quantity_bonus, 0) AS quantity_bonus
        FROM public.purchase_order_items
       WHERE purchase_order_id = p_po_id AND tenant_id = p_tenant_id
    LOOP
      v_qty_received := v_item.quantity + v_item.quantity_bonus;

      SELECT COALESCE(quantity_on_hand, 0)
        INTO v_balance
        FROM public.inventory_balances
       WHERE tenant_id    = p_tenant_id
         AND warehouse_id = v_warehouse_id
         AND product_id   = v_item.product_id;

      IF v_balance < v_qty_received THEN
        RAISE EXCEPTION 'Stock insuficiente para anular: producto % requiere % unidades pero hay %',
          v_item.product_id, v_qty_received, v_balance;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.purchase_orders
     SET status = 'cancelled'
   WHERE id = p_po_id AND tenant_id = p_tenant_id;

  -- ── Revertir cada ítem (movimiento + balance) ────────────────────────
  FOR v_item IN
    SELECT product_id, quantity, COALESCE(quantity_bonus, 0) AS quantity_bonus,
           unit_cost, line_total
      FROM public.purchase_order_items
     WHERE purchase_order_id = p_po_id AND tenant_id = p_tenant_id
  LOOP
    v_qty_received := v_item.quantity + v_item.quantity_bonus;

    -- Usa el costo efectivo almacenado en el movimiento original
    IF v_qty_received > 0 THEN
      v_effective_cost := round(COALESCE(v_item.line_total, 0) / v_qty_received, 4);
    ELSE
      v_effective_cost := v_item.unit_cost;
    END IF;

    INSERT INTO public.inventory_movements (
      tenant_id, warehouse_id, product_id,
      movement_type, quantity, unit_cost, reason,
      reference_type, reference_id, performed_by_user_id, direction
    ) VALUES (
      p_tenant_id, v_warehouse_id, v_item.product_id,
      'purchase_cancel', v_qty_received, v_effective_cost, 'Anulación de compra',
      'purchase_order', p_po_id, v_user_id, -1
    );

    IF v_warehouse_id IS NOT NULL THEN
      UPDATE public.inventory_balances
         SET quantity_on_hand = quantity_on_hand - v_qty_received,
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
