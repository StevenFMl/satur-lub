-- ============================================================
-- v12_inventory_adjustments.sql
--
-- Upgrades inventory adjustment capability:
--
--   · adjust_inventory() RPC — replaces/extends record_stock_adjustment
--       - Validates tenant ownership of product + warehouse
--       - Supports 'absolute' (set to value) and 'relative' (delta)
--       - Records direction (+1/-1) in inventory_movements
--       - Embeds qty_before → qty_after in reason for audit trail
--       - Returns jsonb {movement_id, qty_before, qty_after, delta}
--       - Does NOT recalculate CPP (adjustments are corrections, not purchases)
--       - For positive delta: unit_cost defaults to current average_cost
--       - For negative delta: unit_cost = current average_cost (audit only)
--       - Caller may override unit_cost (e.g. for initial balance with known cost)
--
-- Idempotent: CREATE OR REPLACE for RPC
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- adjust_inventory
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.adjust_inventory(
  p_tenant_id      uuid,
  p_warehouse_id   uuid,
  p_product_id     uuid,
  p_kind           text,       -- 'absolute' | 'relative'
  p_quantity       numeric,    -- target qty (absolute) or signed delta (relative)
  p_unit_cost      numeric     DEFAULT NULL,  -- overrides average_cost when provided
  p_reason         text        DEFAULT NULL,
  p_note           text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid     := auth.uid();
  v_qty_before  numeric(12,4);
  v_delta       numeric(12,4);
  v_qty_after   numeric(12,4);
  v_avg_cost    numeric(14,6);
  v_cost        numeric(14,6);
  v_direction   integer;
  v_mv_id       uuid;
  v_reason_full text;
BEGIN
  -- ── Auth & basic guards ───────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;

  IF p_kind NOT IN ('absolute', 'relative') THEN
    RAISE EXCEPTION 'Tipo de ajuste inválido: %. Use ''absolute'' o ''relative''', p_kind;
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'El motivo del ajuste es obligatorio (mín. 3 caracteres)';
  END IF;

  -- ── Ownership validation ──────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.products
     WHERE id = p_product_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Producto no encontrado para este tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses
     WHERE id = p_warehouse_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Bodega no encontrada para este tenant';
  END IF;

  -- ── Read + lock current balance ───────────────────────────────────────────
  SELECT COALESCE(quantity_on_hand, 0)
    INTO v_qty_before
    FROM public.inventory_balances
   WHERE tenant_id    = p_tenant_id
     AND warehouse_id = p_warehouse_id
     AND product_id   = p_product_id
     FOR UPDATE;

  IF NOT FOUND THEN
    v_qty_before := 0;
  END IF;

  -- ── Compute delta and target ──────────────────────────────────────────────
  IF p_kind = 'relative' THEN
    v_delta     := p_quantity;                    -- signed (can be negative)
    v_qty_after := v_qty_before + v_delta;
  ELSE  -- absolute
    v_qty_after := p_quantity;                    -- explicit target
    v_delta     := v_qty_after - v_qty_before;    -- derived signed delta
  END IF;

  -- ── Business validations ──────────────────────────────────────────────────
  IF v_qty_after < 0 THEN
    RAISE EXCEPTION 'El ajuste resultaría en stock negativo (%.2f → %.2f)', v_qty_before, v_qty_after;
  END IF;

  IF round(v_delta, 4) = 0 THEN
    RAISE EXCEPTION 'El ajuste no produce ningún cambio en el stock (antes = después = %.2f)', v_qty_before;
  END IF;

  -- ── Determine unit_cost ───────────────────────────────────────────────────
  --
  --  Policy (Tarea 2):
  --    · Positive delta (stock IN): use average_cost as default — keeps CPP reference
  --      without recalculating the weighted average (adjustments are corrections,
  --      not purchases). Caller may override with a known cost (e.g. initial balance).
  --    · Negative delta (stock OUT): use average_cost for the movement record
  --      (audit trail of value consumed). CPP is NOT recalculated.
  --
  SELECT COALESCE(average_cost, 0)
    INTO v_avg_cost
    FROM public.products
   WHERE id = p_product_id AND tenant_id = p_tenant_id;

  -- Use caller cost if provided and > 0, else fall back to average_cost
  v_cost := CASE
    WHEN p_unit_cost IS NOT NULL AND p_unit_cost > 0 THEN p_unit_cost::numeric(14,6)
    ELSE v_avg_cost
  END;

  -- ── Direction ─────────────────────────────────────────────────────────────
  v_direction := CASE WHEN v_delta > 0 THEN 1 ELSE -1 END;

  -- ── Build auditable reason string ─────────────────────────────────────────
  --  Format: "<motivo> · <X> → <Y> u."  (optionally with note)
  v_reason_full := trim(p_reason)
    || ' · ' || round(v_qty_before, 2)::text
    || ' → '  || round(v_qty_after,  2)::text || ' u.'
    || CASE
         WHEN p_note IS NOT NULL AND length(trim(p_note)) > 0
         THEN ' | ' || trim(p_note)
         ELSE ''
       END;

  -- ── Insert movement (quantity always positive; direction carries sign) ─────
  INSERT INTO public.inventory_movements (
    tenant_id, warehouse_id, product_id,
    movement_type, quantity, unit_cost, reason,
    reference_type, performed_by_user_id, direction
  ) VALUES (
    p_tenant_id, p_warehouse_id, p_product_id,
    'adjustment', abs(v_delta), round(v_cost, 6), v_reason_full,
    'adjustment', v_user_id, v_direction
  ) RETURNING id INTO v_mv_id;

  -- ── Update balance ────────────────────────────────────────────────────────
  INSERT INTO public.inventory_balances (
    tenant_id, warehouse_id, product_id, quantity_on_hand
  ) VALUES (
    p_tenant_id, p_warehouse_id, p_product_id, round(v_qty_after, 4)
  )
  ON CONFLICT (tenant_id, warehouse_id, product_id) DO UPDATE
    SET quantity_on_hand = round(EXCLUDED.quantity_on_hand, 4),
        updated_at       = now();

  -- ── Return audit result ───────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'movement_id', v_mv_id,
    'qty_before',  round(v_qty_before, 4),
    'qty_after',   round(v_qty_after,  4),
    'delta',       round(v_delta,      4),
    'unit_cost',   round(v_cost,       6)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_inventory(uuid, uuid, uuid, text, numeric, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_inventory(uuid, uuid, uuid, text, numeric, numeric, text, text) TO authenticated;
