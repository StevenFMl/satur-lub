-- ============================================================
-- v6_sale_returns.sql
--
-- 1. inventory_movements: allow 'return' in movement_type.
--    Constraint is found by CONTENT (pg_get_constraintdef), not by an
--    assumed name — safe regardless of what the base schema named it.
-- 2. inventory_movements: allow 'sale_return' in reference_type.
--    Same approach: content-based discovery; only updates if a constraint
--    already existed (conservative — does not add new restrictions to
--    free-text columns).
-- 3. sale_returns table + RLS (FOR ALL with USING + WITH CHECK).
-- 4. sale_return_items table + RLS (FOR ALL with USING + WITH CHECK).
-- 5. create_sale_return RPC.
--    Refund validation:
--      - p_refund_amount < 0         → rejected immediately.
--      - p_refund_amount > line-total  → rejected after computing line totals.
--      - p_refund_amount IS NULL      → auto-calculated from line totals.
--    Refund calculation:
--      - full return  → line_total exactly (no rounding drift).
--      - partial      → ROUND(line_total / quantity * qty_ret, 2).
--    Both handle discount_amount and price overrides correctly.
-- 6. v_sale_returns_list view.
--
-- Design decisions:
--   - Original sale status is NEVER changed by a return.
--   - Only owner/admin can process returns (enforced in RPC).
--   - Only owner/admin can set restock = false (enforced in RPC).
-- ============================================================

-- ── 1. inventory_movements: extend movement_type CHECK ───────
--
-- Discovery strategy: find the constraint by inspecting its definition
-- text, not by a hardcoded name.  Works even if the base schema used a
-- different name (auto-generated or custom).
--
-- After the loop, always (re)create the constraint under the canonical
-- name with the complete allowed-value set.  Safe to re-run.

DO $$
DECLARE
  v_conname text;
BEGIN
  -- Drop every CHECK on this table that references movement_type.
  -- Using a loop handles the rare case of multiple stale constraints.
  FOR v_conname IN
    SELECT c.conname
      FROM pg_constraint  c
      JOIN pg_class       t ON t.oid = c.conrelid
      JOIN pg_namespace   n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'inventory_movements'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%movement_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.inventory_movements DROP CONSTRAINT %I',
      v_conname
    );
  END LOOP;

  -- (Re)create with the definitive name and full value set.
  ALTER TABLE public.inventory_movements
    ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK (movement_type IN (
      'in', 'out', 'adjustment',
      'sale', 'sale_reversal',
      'return',
      'purchase', 'purchase_cancel',
      'transfer'
    ));
END $$;

-- ── 2. inventory_movements: extend reference_type CHECK ──────
--
-- Conservative: only update if a constraint already exists.
-- If reference_type is a free-text column in the base schema, adding a
-- new CHECK constraint here could break existing rows with unlisted values.

DO $$
DECLARE
  v_conname text;
  v_found   boolean := false;
BEGIN
  FOR v_conname IN
    SELECT c.conname
      FROM pg_constraint  c
      JOIN pg_class       t ON t.oid = c.conrelid
      JOIN pg_namespace   n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'inventory_movements'
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%reference_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.inventory_movements DROP CONSTRAINT %I',
      v_conname
    );
    v_found := true;
  END LOOP;

  -- Only recreate the constraint if one already existed.
  IF v_found THEN
    ALTER TABLE public.inventory_movements
      ADD CONSTRAINT inventory_movements_reference_type_check
      CHECK (reference_type IN (
        'sale',
        'sale_return',
        'purchase_order',
        'adjustment',
        'transfer'
      ));
  END IF;
END $$;

-- ── 3. sale_returns ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sale_returns (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES public.tenants(id)   ON DELETE CASCADE,
  original_sale_id  uuid          NOT NULL REFERENCES public.sales(id)     ON DELETE RESTRICT,
  return_type       text          NOT NULL DEFAULT 'partial'
                      CHECK (return_type IN ('full', 'partial', 'exchange')),
  status            text          NOT NULL DEFAULT 'completed'
                      CHECK (status IN ('completed')),
  reason            text          NOT NULL,
  notes             text,
  refund_amount     numeric(12,2) NOT NULL DEFAULT 0
                      CHECK (refund_amount >= 0),
  refund_method     text
                      CHECK (refund_method IN ('cash', 'transfer', 'store_credit')),
  refund_reference  text,
  exchange_sale_id  uuid          REFERENCES public.sales(id)     ON DELETE SET NULL,
  warehouse_id      uuid          REFERENCES public.warehouses(id) ON DELETE SET NULL,
  processed_by      uuid          NOT NULL,
  processed_at      timestamptz   NOT NULL DEFAULT now(),
  created_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_returns_sale
  ON public.sale_returns(tenant_id, original_sale_id);

CREATE INDEX IF NOT EXISTS idx_sale_returns_processed_at
  ON public.sale_returns(tenant_id, processed_at);

ALTER TABLE public.sale_returns ENABLE ROW LEVEL SECURITY;

-- USING  → filters row visibility  (SELECT / UPDATE WHERE / DELETE).
-- WITH CHECK → validates written values (INSERT / UPDATE SET).
-- Both are required for a complete tenant-isolation policy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'sale_returns' AND policyname = 'returns_tenant_access'
  ) THEN
    CREATE POLICY "returns_tenant_access" ON public.sale_returns
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id   = auth.uid()
             AND is_active = true
        )
      )
      WITH CHECK (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id   = auth.uid()
             AND is_active = true
        )
      );
  END IF;
END $$;

-- ── 4. sale_return_items ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sale_return_items (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid          NOT NULL REFERENCES public.tenants(id)      ON DELETE CASCADE,
  sale_return_id    uuid          NOT NULL REFERENCES public.sale_returns(id) ON DELETE CASCADE,
  sale_item_id      uuid          NOT NULL REFERENCES public.sale_items(id)   ON DELETE RESTRICT,
  product_id        uuid          NOT NULL,
  quantity_returned numeric(12,4) NOT NULL CHECK (quantity_returned > 0),
  base_qty          numeric(12,4) NOT NULL DEFAULT 1,
  unit_price        numeric(12,2) NOT NULL DEFAULT 0,
  -- line_refund = proportional share of line_total, not quantity * unit_price.
  -- Handles discount_amount and price overrides correctly.
  line_refund       numeric(12,2) NOT NULL DEFAULT 0,
  restock           boolean       NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_return_items_return
  ON public.sale_return_items(tenant_id, sale_return_id);

CREATE INDEX IF NOT EXISTS idx_return_items_sale_item
  ON public.sale_return_items(tenant_id, sale_item_id);

ALTER TABLE public.sale_return_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'sale_return_items' AND policyname = 'return_items_tenant_access'
  ) THEN
    CREATE POLICY "return_items_tenant_access" ON public.sale_return_items
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id   = auth.uid()
             AND is_active = true
        )
      )
      WITH CHECK (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id   = auth.uid()
             AND is_active = true
        )
      );
  END IF;
END $$;

-- ── 5. create_sale_return RPC ────────────────────────────────

DROP FUNCTION IF EXISTS public.create_sale_return(uuid, uuid, jsonb, text, text, numeric, text, text, uuid);

CREATE OR REPLACE FUNCTION public.create_sale_return(
  p_tenant_id        uuid,
  p_sale_id          uuid,
  p_items            jsonb,    -- [{sale_item_id, quantity_returned, restock?}]
  p_reason           text,
  p_notes            text      DEFAULT NULL,
  p_refund_amount    numeric   DEFAULT NULL,  -- NULL → auto-calculated; must be ≤ line totals
  p_refund_method    text      DEFAULT NULL,
  p_refund_reference text      DEFAULT NULL,
  p_exchange_sale_id uuid      DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          uuid;
  v_is_privileged    boolean;
  v_sale_status      text;
  v_warehouse_id     uuid;
  v_sale_return_id   uuid;
  v_item             jsonb;
  v_sale_item_id     uuid;
  v_quantity_ret     numeric(12,4);
  v_restock          boolean;
  -- sale_item snapshot
  v_si_quantity      numeric(12,4);
  v_si_unit_price    numeric(12,2);
  v_si_line_total    numeric(12,2);
  v_si_base_qty      numeric(12,4);
  v_si_product_id    uuid;
  v_si_track_inv     boolean;
  -- computed per iteration
  v_already_ret      numeric(12,4);
  v_available        numeric(12,4);
  v_inv_qty          numeric(12,4);
  v_line_refund      numeric(12,2);
  -- accumulators
  v_total_refund     numeric(12,2) := 0;
  v_this_batch       numeric(12,4) := 0;
  -- derived
  v_return_type      text;
  v_all_sold         numeric(12,4);
  v_all_returned     numeric(12,4);
BEGIN
  -- ── Auth ───────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;

  -- ── Role: only owner/admin ──────────────────────────────────
  SELECT CASE WHEN role IN ('owner', 'admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM public.tenant_memberships
   WHERE tenant_id = p_tenant_id
     AND user_id   = v_user_id
     AND is_active = true;

  IF v_is_privileged IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a este tenant.';
  END IF;
  IF NOT v_is_privileged THEN
    RAISE EXCEPTION 'Sin permisos para procesar devoluciones.';
  END IF;

  -- ── Input validations (fail-fast before any writes) ────────
  IF trim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Se requiere un motivo para la devolución.';
  END IF;

  IF p_refund_method IS NOT NULL
     AND p_refund_method NOT IN ('cash', 'transfer', 'store_credit') THEN
    RAISE EXCEPTION 'Método de reembolso inválido: %.', p_refund_method;
  END IF;

  -- Reject obviously invalid refund_amount before touching any rows.
  -- The upper-bound check (> v_total_refund) comes after the items loop
  -- once we know the computed total.
  IF p_refund_amount IS NOT NULL AND p_refund_amount < 0 THEN
    RAISE EXCEPTION 'El monto de reembolso no puede ser negativo.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La devolución requiere al menos un ítem.';
  END IF;

  -- ── Load + lock sale ───────────────────────────────────────
  SELECT status, warehouse_id
    INTO v_sale_status, v_warehouse_id
    FROM public.sales
   WHERE id        = p_sale_id
     AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada.';
  END IF;
  IF v_sale_status = 'cancelled' THEN
    RAISE EXCEPTION 'No se puede devolver una venta anulada.';
  END IF;
  IF v_sale_status <> 'confirmed' THEN
    RAISE EXCEPTION
      'Solo se pueden devolver ventas confirmadas. Estado actual: %.', v_sale_status;
  END IF;

  -- ── Pre-validate all items (fail-fast before any inserts) ──
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sale_item_id := (v_item->>'sale_item_id')::uuid;
    v_quantity_ret := (v_item->>'quantity_returned')::numeric;
    v_restock      := COALESCE((v_item->>'restock')::boolean, true);

    IF NOT v_restock AND NOT v_is_privileged THEN
      RAISE EXCEPTION
        'Sin permisos para marcar productos como no reingresables al stock.';
    END IF;

    IF v_quantity_ret IS NULL OR v_quantity_ret <= 0 THEN
      RAISE EXCEPTION 'La cantidad a devolver debe ser mayor que cero.';
    END IF;

    SELECT si.quantity, si.base_qty, si.product_id
      INTO v_si_quantity, v_si_base_qty, v_si_product_id
      FROM public.sale_items si
     WHERE si.id        = v_sale_item_id
       AND si.sale_id   = p_sale_id
       AND si.tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Ítem de venta % no encontrado en esta venta.', v_sale_item_id;
    END IF;

    SELECT COALESCE(SUM(sri.quantity_returned), 0)
      INTO v_already_ret
      FROM public.sale_return_items sri
      JOIN public.sale_returns sr ON sr.id = sri.sale_return_id
     WHERE sri.sale_item_id = v_sale_item_id
       AND sr.tenant_id     = p_tenant_id;

    v_available := v_si_quantity - v_already_ret;

    IF v_quantity_ret > v_available THEN
      RAISE EXCEPTION
        'Cantidad a devolver (%) excede lo disponible (%) para el ítem %.',
        v_quantity_ret, v_available, v_sale_item_id;
    END IF;

    v_this_batch := v_this_batch + v_quantity_ret;
  END LOOP;

  -- ── Determine return_type ──────────────────────────────────
  IF p_exchange_sale_id IS NOT NULL THEN
    v_return_type := 'exchange';
  ELSE
    SELECT COALESCE(SUM(si.quantity), 0)
      INTO v_all_sold
      FROM public.sale_items si
     WHERE si.sale_id   = p_sale_id
       AND si.tenant_id = p_tenant_id;

    SELECT COALESCE(SUM(sri.quantity_returned), 0)
      INTO v_all_returned
      FROM public.sale_return_items sri
      JOIN public.sale_returns sr ON sr.id = sri.sale_return_id
     WHERE sr.original_sale_id = p_sale_id
       AND sr.tenant_id        = p_tenant_id;

    v_return_type := CASE
      WHEN (v_all_returned + v_this_batch) >= v_all_sold THEN 'full'
      ELSE 'partial'
    END;
  END IF;

  -- ── Insert sale_returns header (refund_amount finalized below) ──
  INSERT INTO public.sale_returns (
    tenant_id, original_sale_id, return_type, status,
    reason, notes,
    refund_amount, refund_method, refund_reference,
    exchange_sale_id, warehouse_id, processed_by
  )
  VALUES (
    p_tenant_id, p_sale_id, v_return_type, 'completed',
    trim(p_reason),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    0,  -- placeholder; updated after items loop
    p_refund_method,
    NULLIF(trim(COALESCE(p_refund_reference, '')), ''),
    p_exchange_sale_id, v_warehouse_id, v_user_id
  )
  RETURNING id INTO v_sale_return_id;

  -- ── Insert items + compute refund totals + inventory ───────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sale_item_id := (v_item->>'sale_item_id')::uuid;
    v_quantity_ret := (v_item->>'quantity_returned')::numeric;
    v_restock      := COALESCE((v_item->>'restock')::boolean, true);

    -- Re-read sale_item including line_total (needed for proportional refund)
    SELECT si.quantity, si.unit_price, si.line_total, si.base_qty, si.product_id
      INTO v_si_quantity, v_si_unit_price, v_si_line_total, v_si_base_qty, v_si_product_id
      FROM public.sale_items si
     WHERE si.id        = v_sale_item_id
       AND si.sale_id   = p_sale_id
       AND si.tenant_id = p_tenant_id;

    -- ── Proportional refund from line_total ─────────────────
    -- line_total = GREATEST(quantity * unit_price - discount_amount, 0)
    -- Already accounts for any discount or price override.
    --
    --   Full return  → use line_total exactly (no rounding drift).
    --   Partial      → ROUND(line_total / quantity * qty_ret, 2).
    --
    -- PostgreSQL ROUND on numeric = "round half away from zero",
    -- which matches Big.roundHalfUp in the client preview.
    IF v_si_quantity > 0 THEN
      IF v_quantity_ret = v_si_quantity THEN
        v_line_refund := COALESCE(v_si_line_total, 0);
      ELSE
        v_line_refund := ROUND(
          COALESCE(v_si_line_total, 0) / v_si_quantity * v_quantity_ret,
          2
        );
      END IF;
    ELSE
      v_line_refund := 0;
    END IF;

    v_total_refund := v_total_refund + v_line_refund;
    v_inv_qty      := v_quantity_ret * COALESCE(v_si_base_qty, 1);

    INSERT INTO public.sale_return_items (
      tenant_id, sale_return_id, sale_item_id,
      product_id, quantity_returned, base_qty,
      unit_price, line_refund, restock
    )
    VALUES (
      p_tenant_id, v_sale_return_id, v_sale_item_id,
      v_si_product_id, v_quantity_ret, COALESCE(v_si_base_qty, 1),
      v_si_unit_price, v_line_refund, v_restock
    );

    -- Inventory reversal: only when restock=true and warehouse is known
    IF v_restock AND v_warehouse_id IS NOT NULL THEN
      SELECT COALESCE(p.track_inventory, false)
        INTO v_si_track_inv
        FROM public.products p
       WHERE p.id        = v_si_product_id
         AND p.tenant_id = p_tenant_id;

      IF v_si_track_inv THEN
        INSERT INTO public.inventory_movements (
          tenant_id, warehouse_id, product_id,
          movement_type, quantity, reason, direction,
          reference_type, reference_id, performed_by_user_id
        )
        VALUES (
          p_tenant_id, v_warehouse_id, v_si_product_id,
          'return', v_inv_qty, 'Devolución de venta', 1,
          'sale_return', v_sale_return_id, v_user_id
        );

        INSERT INTO public.inventory_balances (
          tenant_id, warehouse_id, product_id, quantity_on_hand
        )
        VALUES (
          p_tenant_id, v_warehouse_id, v_si_product_id, v_inv_qty
        )
        ON CONFLICT (tenant_id, warehouse_id, product_id)
        DO UPDATE SET
          quantity_on_hand =
            public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
          updated_at = now();
      END IF;
    END IF;
  END LOOP;

  -- ── Validate and apply final refund_amount ─────────────────
  -- Now that v_total_refund is known, enforce the upper-bound rule.
  -- Overpaying a return has no valid automatic business justification;
  -- if a custom amount is provided it must not exceed what was charged.
  IF p_refund_amount IS NOT NULL AND p_refund_amount > v_total_refund THEN
    RAISE EXCEPTION
      'El monto de reembolso ($%) no puede superar el total calculado por líneas ($%).',
      p_refund_amount, v_total_refund;
  END IF;

  UPDATE public.sale_returns
     SET refund_amount = COALESCE(p_refund_amount, v_total_refund)
   WHERE id = v_sale_return_id;

  RETURN v_sale_return_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, numeric, text, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_sale_return(uuid, uuid, jsonb, text, text, numeric, text, text, uuid) TO authenticated;

-- ── 6. v_sale_returns_list view ──────────────────────────────
-- security_invoker = true: RLS on underlying tables is respected.

DROP VIEW IF EXISTS public.v_sale_returns_list;

CREATE VIEW public.v_sale_returns_list
WITH (security_invoker = true)
AS
SELECT
  sr.id,
  sr.tenant_id,
  sr.original_sale_id,
  sr.return_type,
  sr.status,
  sr.reason,
  sr.notes,
  sr.refund_amount,
  sr.refund_method,
  sr.refund_reference,
  sr.exchange_sale_id,
  sr.warehouse_id,
  sr.processed_by,
  sr.processed_at,
  sr.created_at
FROM public.sale_returns sr;

GRANT SELECT ON public.v_sale_returns_list TO authenticated;
