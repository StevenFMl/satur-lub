-- ============================================================
-- v37_fix_void_sale_kits_and_receivables.sql
--
-- Redefine public.void_sale to address two critical P0 flaws:
--   1. Restock kit/bundle components when voiding sales.
--   2. Invalidate associated customer receivables on credit sales,
--      preventing voiding if subsequent payments exist.
-- ============================================================

DROP FUNCTION IF EXISTS public.void_sale(uuid, uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.void_sale(
  p_tenant_id       uuid,
  p_sale_id         uuid,
  p_reason          text,
  p_note            text DEFAULT NULL,
  p_cash_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            uuid;
  v_is_privileged      boolean;
  v_sale_status        text;
  v_warehouse_id       uuid;
  v_item               record;
  v_inv_qty            numeric(12,4);
  v_cash_refund        numeric(12,2);
  v_sess_status        text;
  v_sess_warehouse_id  uuid;
  
  -- Credit variables
  v_receivable_id      uuid;
  v_rec_paid           numeric(12,2);
  v_rec_total          numeric(12,2);
  v_rec_status         text;
  
  -- Kit/Product resolution variables
  v_track_inventory    boolean;
  v_product_kind       text;
  v_comp               record;
  v_comp_restock_qty   numeric(12,4);
BEGIN
  -- ── 1. Authenticate user ───────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  -- ── 2. Privilege validation ────────────────────────────────────────────
  SELECT CASE WHEN role IN ('owner', 'admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM public.tenant_memberships
   WHERE tenant_id = p_tenant_id AND user_id = v_user_id AND is_active = true;

  IF v_is_privileged IS NULL THEN RAISE EXCEPTION 'Sin acceso a este tenant.'; END IF;
  IF NOT v_is_privileged THEN RAISE EXCEPTION 'Sin permisos para anular ventas.'; END IF;

  -- ── 3. Void reason validation ──────────────────────────────────────────
  IF trim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Se requiere un motivo para anular la venta.';
  END IF;

  -- ── 4. Load & Lock Sale Row ────────────────────────────────────────────
  SELECT status, warehouse_id INTO v_sale_status, v_warehouse_id
    FROM public.sales WHERE id = p_sale_id AND tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.'; END IF;
  IF v_sale_status = 'cancelled' THEN RAISE EXCEPTION 'La venta ya está anulada.'; END IF;
  IF v_sale_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Solo se pueden anular ventas confirmadas. Estado actual: %.', v_sale_status;
  END IF;

  -- ── 5. Cash Session Coherence Checks ───────────────────────────────────
  IF p_cash_session_id IS NOT NULL THEN
    SELECT status, warehouse_id
      INTO v_sess_status, v_sess_warehouse_id
      FROM public.cash_sessions WHERE id = p_cash_session_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de caja no encontrada.'; END IF;
    IF v_sess_status <> 'open' THEN RAISE EXCEPTION 'La sesión de caja no está abierta.'; END IF;

    IF NOT (
      (v_sess_warehouse_id IS NULL     AND v_warehouse_id IS NULL) OR
      (v_sess_warehouse_id IS NOT NULL AND v_warehouse_id IS NOT NULL
       AND v_sess_warehouse_id = v_warehouse_id)
    ) THEN
      RAISE EXCEPTION 'La sesión de caja no corresponde a la bodega de esta venta.';
    END IF;
  END IF;

  -- ── 6. Credit Sale & Collections Guard (P0-2) ──────────────────────────
  SELECT id, paid_amount, total_amount, status
    INTO v_receivable_id, v_rec_paid, v_rec_total, v_rec_status
    FROM public.customer_receivables
   WHERE sale_id = p_sale_id AND tenant_id = p_tenant_id;

  IF FOUND THEN
    -- If there are subsequent payments (cobranzas) in customer_receivable_payments, block voiding!
    IF EXISTS (
      SELECT 1 FROM public.customer_receivable_payments
       WHERE receivable_id = v_receivable_id AND tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'No se puede anular una venta a crédito que ya registra abonos posteriores.';
    END IF;
  END IF;

  -- ── 7. Execute Sale Cancellation status write ──────────────────────────
  UPDATE public.sales
     SET status              = 'cancelled',
         cancelled_at        = now(),
         cancelled_by        = v_user_id,
         cancellation_reason = trim(p_reason),
         cancellation_note   = NULLIF(trim(COALESCE(p_note, '')), '')
   WHERE id = p_sale_id AND tenant_id = p_tenant_id;

  -- ── 8. Cancel receivable account (P0-2) ────────────────────────────────
  IF v_receivable_id IS NOT NULL THEN
    UPDATE public.customer_receivables
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = v_receivable_id AND tenant_id = p_tenant_id;
  END IF;

  -- ── 9. Atomic Inventory Re-stocking (P0-1) ─────────────────────────────
  IF v_warehouse_id IS NOT NULL THEN
    FOR v_item IN
      SELECT si.product_id, si.quantity, COALESCE(si.base_qty, 1) AS base_qty, si.item_name
        FROM public.sale_items si
       WHERE si.sale_id = p_sale_id AND si.tenant_id = p_tenant_id
    LOOP
      IF v_item.product_id IS NOT NULL THEN
        -- Load inventory tracking configuration and product kind
        SELECT COALESCE(p.track_inventory, false), COALESCE(p.product_kind, 'regular')
          INTO v_track_inventory, v_product_kind
          FROM public.products p
         WHERE p.id = v_item.product_id AND p.tenant_id = p_tenant_id;

        IF FOUND THEN
          IF v_product_kind IN ('kit', 'bundle') THEN
            -- ── Kit/Bundle: restock each component individually ──────────
            FOR v_comp IN
              SELECT bi.component_product_id,
                     bi.quantity AS comp_quantity,
                     bi.base_qty AS comp_base_qty,
                     COALESCE(p.track_inventory, false) AS comp_track_inv
                FROM public.bundle_items bi
                JOIN public.products p ON p.id = bi.component_product_id AND p.tenant_id = p_tenant_id
               WHERE bi.bundle_product_id = v_item.product_id AND bi.tenant_id = p_tenant_id
            LOOP
              IF v_comp.comp_track_inv THEN
                -- comp_restock_qty = kit_sold_quantity * kit_base_qty * component_quantity_per_kit * component_base_qty
                v_comp_restock_qty := v_item.quantity * v_item.base_qty * v_comp.comp_quantity * v_comp.comp_base_qty;

                INSERT INTO public.inventory_movements (
                  tenant_id, warehouse_id, product_id, movement_type, quantity, reason,
                  direction, reference_type, reference_id, performed_by_user_id
                ) VALUES (
                  p_tenant_id, v_warehouse_id, v_comp.component_product_id,
                  'sale_reversal', v_comp_restock_qty,
                  'Anulación de venta (componente de kit): ' || COALESCE(v_item.item_name, ''),
                  1, 'sale', p_sale_id, v_user_id
                );

                INSERT INTO public.inventory_balances (tenant_id, warehouse_id, product_id, quantity_on_hand)
                VALUES (p_tenant_id, v_warehouse_id, v_comp.component_product_id, v_comp_restock_qty)
                ON CONFLICT (tenant_id, warehouse_id, product_id)
                DO UPDATE SET
                  quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
                  updated_at = now();
              END IF;
            END LOOP;

          ELSIF v_track_inventory THEN
            -- ── Simple item: restock directly ───────────────────────────
            v_inv_qty := v_item.quantity * v_item.base_qty;

            INSERT INTO public.inventory_movements (
              tenant_id, warehouse_id, product_id, movement_type, quantity, reason,
              direction, reference_type, reference_id, performed_by_user_id
            ) VALUES (
              p_tenant_id, v_warehouse_id, v_item.product_id,
              'sale_reversal', v_inv_qty, 'Anulación de venta', 1,
              'sale', p_sale_id, v_user_id
            );

            INSERT INTO public.inventory_balances (tenant_id, warehouse_id, product_id, quantity_on_hand)
            VALUES (p_tenant_id, v_warehouse_id, v_item.product_id, v_inv_qty)
            ON CONFLICT (tenant_id, warehouse_id, product_id)
            DO UPDATE SET
              quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
              updated_at = now();
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── 10. Revert physical cash from cash drawer session (if active) ──────
  IF p_cash_session_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_cash_refund
      FROM public.sale_payments
     WHERE sale_id = p_sale_id AND tenant_id = p_tenant_id AND payment_method = 'cash';

    IF v_cash_refund > 0 THEN
      INSERT INTO public.cash_movements (
        tenant_id, cash_session_id, movement_type, direction,
        amount, reason, reference_type, reference_id, created_by
      ) VALUES (
        p_tenant_id, p_cash_session_id, 'cash_out', -1,
        v_cash_refund, 'Anulación de venta - Efectivo', 'void_sale', p_sale_id, v_user_id
      );
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.void_sale(uuid, uuid, text, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.void_sale(uuid, uuid, text, text, uuid) TO authenticated;
