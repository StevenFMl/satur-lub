-- ============================================================
-- v39_void_and_refund_receivables_fix.sql
--
-- Dos correcciones quirúrgicas en las RPCs de post-venta:
--
--   1. void_sale — bloquear anulación si existen devoluciones
--      completadas.  Se agrega un guard ANTES de cualquier
--      escritura.  Todo lo demás queda idéntico a v37.
--
--   2. create_sale_return — amortizar deuda de cuentas por cobrar
--      activas antes de emitir reembolso físico.  Solo el
--      excedente sobre la deuda sale como efectivo/transferencia.
--      Las devoluciones de ventas al contado (sin receivable) no
--      cambian de comportamiento.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. void_sale
-- ══════════════════════════════════════════════════════════════

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

  -- ── 5. Block void if completed returns exist (NEW) ─────────────────────
  -- Una venta con devoluciones completadas ya restituyó stock y/o dinero;
  -- anularla además produciría doble restitución de inventario y caja.
  IF EXISTS (
    SELECT 1
      FROM public.sale_returns
     WHERE original_sale_id = p_sale_id
       AND tenant_id        = p_tenant_id
       AND status           = 'completed'
  ) THEN
    RAISE EXCEPTION 'No se puede anular una venta que tiene devoluciones completadas asociadas.';
  END IF;

  -- ── 6. Cash Session Coherence Checks ───────────────────────────────────
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

  -- ── 7. Credit Sale & Collections Guard ────────────────────────────────
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

  -- ── 8. Execute Sale Cancellation status write ──────────────────────────
  UPDATE public.sales
     SET status              = 'cancelled',
         cancelled_at        = now(),
         cancelled_by        = v_user_id,
         cancellation_reason = trim(p_reason),
         cancellation_note   = NULLIF(trim(COALESCE(p_note, '')), '')
   WHERE id = p_sale_id AND tenant_id = p_tenant_id;

  -- ── 9. Cancel receivable account ──────────────────────────────────────
  IF v_receivable_id IS NOT NULL THEN
    UPDATE public.customer_receivables
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = v_receivable_id AND tenant_id = p_tenant_id;
  END IF;

  -- ── 10. Atomic Inventory Re-stocking ──────────────────────────────────
  IF v_warehouse_id IS NOT NULL THEN
    FOR v_item IN
      SELECT si.product_id, si.quantity, COALESCE(si.base_qty, 1) AS base_qty, si.item_name
        FROM public.sale_items si
       WHERE si.sale_id = p_sale_id AND si.tenant_id = p_tenant_id
    LOOP
      IF v_item.product_id IS NOT NULL THEN
        SELECT COALESCE(p.track_inventory, false), COALESCE(p.product_kind, 'regular')
          INTO v_track_inventory, v_product_kind
          FROM public.products p
         WHERE p.id = v_item.product_id AND p.tenant_id = p_tenant_id;

        IF FOUND THEN
          IF v_product_kind IN ('kit', 'bundle') THEN
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

  -- ── 11. Revert physical cash from cash drawer session (if active) ──────
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


-- ══════════════════════════════════════════════════════════════
-- 2. create_sale_return
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_sale_return(
  p_tenant_id        uuid,
  p_sale_id          uuid,
  p_items            jsonb,
  p_reason           text,
  p_notes            text    DEFAULT NULL,
  p_refund_amount    numeric DEFAULT NULL,
  p_refund_method    text    DEFAULT NULL,
  p_refund_reference text    DEFAULT NULL,
  p_exchange_sale_id uuid    DEFAULT NULL,
  p_cash_session_id  uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            uuid;
  v_is_privileged      boolean;
  v_sale_status        text;
  v_warehouse_id       uuid;
  v_sale_return_id     uuid;
  v_item               jsonb;
  v_sale_item_id       uuid;
  v_quantity_ret       numeric(12,4);
  v_restock            boolean;
  v_si_quantity        numeric(12,4);
  v_si_unit_price      numeric(12,2);
  v_si_line_total      numeric(12,2);
  v_si_base_qty        numeric(12,4);
  v_si_product_id      uuid;
  v_si_track_inv       boolean;
  v_si_product_kind    text;
  v_comp               record;
  v_comp_restock_qty   numeric(12,4);
  v_already_ret        numeric(12,4);
  v_available          numeric(12,4);
  v_inv_qty            numeric(12,4);
  v_line_refund        numeric(12,2);
  v_total_refund       numeric(12,2) := 0;
  v_this_batch         numeric(12,4) := 0;
  v_return_type        text;
  v_all_sold           numeric(12,4);
  v_all_returned       numeric(12,4);
  v_final_refund       numeric(12,2);
  v_sess_status        text;
  v_sess_warehouse_id  uuid;

  -- Receivable amortization (NEW)
  v_receivable_id      uuid;
  v_rec_balance_due    numeric(12,2);
  v_rec_paid_amount    numeric(12,2);
  v_rec_total_amount   numeric(12,2);
  v_amortized_amount   numeric(12,2) := 0;  -- portion of refund that cancels debt
  v_physical_refund    numeric(12,2);        -- remainder that leaves the business as cash
  v_new_paid           numeric(12,2);
  v_new_rec_status     text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  SELECT CASE WHEN role IN ('owner', 'admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM public.tenant_memberships
   WHERE tenant_id = p_tenant_id AND user_id = v_user_id AND is_active = true;

  IF v_is_privileged IS NULL THEN RAISE EXCEPTION 'Sin acceso a este tenant.'; END IF;
  IF NOT v_is_privileged THEN RAISE EXCEPTION 'Sin permisos para procesar devoluciones.'; END IF;

  IF trim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'Se requiere un motivo para la devolución.'; END IF;
  IF p_refund_method IS NOT NULL AND p_refund_method NOT IN ('cash', 'transfer', 'store_credit') THEN
    RAISE EXCEPTION 'Método de reembolso inválido: %.', p_refund_method;
  END IF;
  IF p_refund_amount IS NOT NULL AND p_refund_amount < 0 THEN
    RAISE EXCEPTION 'El monto de reembolso no puede ser negativo.';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La devolución requiere al menos un ítem.';
  END IF;

  -- Load the sale first — warehouse_id is needed for the session coherence check below.
  SELECT status, warehouse_id INTO v_sale_status, v_warehouse_id
    FROM public.sales WHERE id = p_sale_id AND tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.'; END IF;
  IF v_sale_status = 'cancelled' THEN RAISE EXCEPTION 'No se puede devolver una venta anulada.'; END IF;
  IF v_sale_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Solo se pueden devolver ventas confirmadas. Estado actual: %.', v_sale_status;
  END IF;

  -- Validate cash session: status + warehouse coherence against the sale's warehouse.
  IF p_cash_session_id IS NOT NULL THEN
    SELECT status, warehouse_id
      INTO v_sess_status, v_sess_warehouse_id
      FROM cash_sessions WHERE id = p_cash_session_id AND tenant_id = p_tenant_id;
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

  -- ── Pass 1: validate quantities ──────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sale_item_id := (v_item->>'sale_item_id')::uuid;
    v_quantity_ret := (v_item->>'quantity_returned')::numeric;
    v_restock      := COALESCE((v_item->>'restock')::boolean, true);

    IF NOT v_restock AND NOT v_is_privileged THEN
      RAISE EXCEPTION 'Sin permisos para marcar productos como no reingresables al stock.';
    END IF;
    IF v_quantity_ret IS NULL OR v_quantity_ret <= 0 THEN
      RAISE EXCEPTION 'La cantidad a devolver debe ser mayor que cero.';
    END IF;

    SELECT si.quantity, si.base_qty, si.product_id
      INTO v_si_quantity, v_si_base_qty, v_si_product_id
      FROM public.sale_items si
     WHERE si.id = v_sale_item_id AND si.sale_id = p_sale_id AND si.tenant_id = p_tenant_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Ítem de venta % no encontrado en esta venta.', v_sale_item_id; END IF;

    SELECT COALESCE(SUM(sri.quantity_returned), 0) INTO v_already_ret
      FROM public.sale_return_items sri
      JOIN public.sale_returns sr ON sr.id = sri.sale_return_id
     WHERE sri.sale_item_id = v_sale_item_id AND sr.tenant_id = p_tenant_id;

    v_available := v_si_quantity - v_already_ret;
    IF v_quantity_ret > v_available THEN
      RAISE EXCEPTION 'Cantidad a devolver (%) excede lo disponible (%) para el ítem %.',
        v_quantity_ret, v_available, v_sale_item_id;
    END IF;
    v_this_batch := v_this_batch + v_quantity_ret;
  END LOOP;

  -- ── Determine return type ────────────────────────────────────────────────
  IF p_exchange_sale_id IS NOT NULL THEN
    v_return_type := 'exchange';
  ELSE
    SELECT COALESCE(SUM(si.quantity), 0) INTO v_all_sold
      FROM public.sale_items si WHERE si.sale_id = p_sale_id AND si.tenant_id = p_tenant_id;
    SELECT COALESCE(SUM(sri.quantity_returned), 0) INTO v_all_returned
      FROM public.sale_return_items sri
      JOIN public.sale_returns sr ON sr.id = sri.sale_return_id
     WHERE sr.original_sale_id = p_sale_id AND sr.tenant_id = p_tenant_id;
    v_return_type := CASE WHEN (v_all_returned + v_this_batch) >= v_all_sold THEN 'full' ELSE 'partial' END;
  END IF;

  INSERT INTO public.sale_returns (
    tenant_id, original_sale_id, return_type, status, reason, notes,
    refund_amount, refund_method, refund_reference, exchange_sale_id, warehouse_id, processed_by
  ) VALUES (
    p_tenant_id, p_sale_id, v_return_type, 'completed',
    trim(p_reason), NULLIF(trim(COALESCE(p_notes, '')), ''),
    0, p_refund_method, NULLIF(trim(COALESCE(p_refund_reference, '')), ''),
    p_exchange_sale_id, v_warehouse_id, v_user_id
  ) RETURNING id INTO v_sale_return_id;

  -- ── Pass 2: record return items + restock ────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sale_item_id := (v_item->>'sale_item_id')::uuid;
    v_quantity_ret := (v_item->>'quantity_returned')::numeric;
    v_restock      := COALESCE((v_item->>'restock')::boolean, true);

    SELECT si.quantity, si.unit_price, si.line_total, si.base_qty, si.product_id
      INTO v_si_quantity, v_si_unit_price, v_si_line_total, v_si_base_qty, v_si_product_id
      FROM public.sale_items si
     WHERE si.id = v_sale_item_id AND si.sale_id = p_sale_id AND si.tenant_id = p_tenant_id;

    IF v_si_quantity > 0 THEN
      IF v_quantity_ret = v_si_quantity THEN
        v_line_refund := COALESCE(v_si_line_total, 0);
      ELSE
        v_line_refund := ROUND(COALESCE(v_si_line_total, 0) / v_si_quantity * v_quantity_ret, 2);
      END IF;
    ELSE
      v_line_refund := 0;
    END IF;

    v_total_refund := v_total_refund + v_line_refund;
    v_inv_qty      := v_quantity_ret * COALESCE(v_si_base_qty, 1);

    INSERT INTO public.sale_return_items (
      tenant_id, sale_return_id, sale_item_id, product_id,
      quantity_returned, base_qty, unit_price, line_refund, restock
    ) VALUES (
      p_tenant_id, v_sale_return_id, v_sale_item_id, v_si_product_id,
      v_quantity_ret, COALESCE(v_si_base_qty, 1), v_si_unit_price, v_line_refund, v_restock
    );

    -- ── Restock block ──────────────────────────────────────────────────────
    IF v_restock AND v_warehouse_id IS NOT NULL THEN

      SELECT COALESCE(p.track_inventory, false),
             COALESCE(p.product_kind, 'regular')
        INTO v_si_track_inv, v_si_product_kind
        FROM public.products p
       WHERE p.id = v_si_product_id AND p.tenant_id = p_tenant_id;

      IF v_si_product_kind IN ('kit', 'bundle') THEN
        FOR v_comp IN
          SELECT bi.component_product_id,
                 bi.quantity   AS comp_quantity,
                 bi.base_qty   AS comp_base_qty,
                 COALESCE(p.track_inventory, false) AS comp_track_inv
            FROM public.bundle_items bi
            JOIN public.products p
              ON p.id = bi.component_product_id AND p.tenant_id = p_tenant_id
           WHERE bi.bundle_product_id = v_si_product_id
             AND bi.tenant_id         = p_tenant_id
        LOOP
          IF v_comp.comp_track_inv THEN
            v_comp_restock_qty := v_inv_qty * v_comp.comp_quantity * v_comp.comp_base_qty;

            INSERT INTO public.inventory_movements (
              tenant_id, warehouse_id, product_id, movement_type, quantity, reason,
              direction, reference_type, reference_id, performed_by_user_id
            ) VALUES (
              p_tenant_id, v_warehouse_id, v_comp.component_product_id,
              'return', v_comp_restock_qty,
              'Devolución de venta (componente de kit)', 1,
              'sale_return', v_sale_return_id, v_user_id
            );

            INSERT INTO public.inventory_balances (
              tenant_id, warehouse_id, product_id, quantity_on_hand
            )
            VALUES (p_tenant_id, v_warehouse_id, v_comp.component_product_id, v_comp_restock_qty)
            ON CONFLICT (tenant_id, warehouse_id, product_id)
            DO UPDATE SET
              quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
              updated_at = now();
          END IF;
        END LOOP;

      ELSIF v_si_track_inv THEN
        INSERT INTO public.inventory_movements (
          tenant_id, warehouse_id, product_id, movement_type, quantity, reason,
          direction, reference_type, reference_id, performed_by_user_id
        ) VALUES (
          p_tenant_id, v_warehouse_id, v_si_product_id, 'return', v_inv_qty,
          'Devolución de venta', 1, 'sale_return', v_sale_return_id, v_user_id
        );
        INSERT INTO public.inventory_balances (tenant_id, warehouse_id, product_id, quantity_on_hand)
        VALUES (p_tenant_id, v_warehouse_id, v_si_product_id, v_inv_qty)
        ON CONFLICT (tenant_id, warehouse_id, product_id)
        DO UPDATE SET
          quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
          updated_at = now();
      END IF;

    END IF;
    -- ── End restock block ──────────────────────────────────────────────────

  END LOOP;

  IF p_refund_amount IS NOT NULL AND p_refund_amount > v_total_refund THEN
    RAISE EXCEPTION 'El monto de reembolso ($%) no puede superar el total calculado por líneas ($%).',
      p_refund_amount, v_total_refund;
  END IF;

  v_final_refund := COALESCE(p_refund_amount, v_total_refund);

  UPDATE public.sale_returns SET refund_amount = v_final_refund WHERE id = v_sale_return_id;

  -- ── Receivable amortization (NEW) ─────────────────────────────────────
  --
  -- SEMÁNTICA DE refund_amount (sale_returns):
  --   sale_returns.refund_amount = v_final_refund  →  valor bruto devuelto
  --   (total de la mercancía que regresa, sin importar cómo se liquida).
  --   Este valor NO cambia aquí; ya fue persistido arriba.
  --
  --   El valor bruto se divide en dos componentes complementarios:
  --     · v_amortized_amount  → cancela deuda en customer_receivables
  --     · v_physical_refund   → sale de caja (cash_movements)
  --
  --   Para ventas al contado: v_amortized = 0, v_physical = v_final.
  --   Para ventas a crédito:  v_amortized = LEAST(refund, balance_due),
  --                           v_physical  = excedente.
  --
  --   Consistencia: refund_amount = SUM(sale_return_items.line_refund).
  --   cash_movements refleja únicamente v_physical_refund (dinero real).
  --   La reducción de deuda es visible en customer_receivables.paid_amount.
  --
  --   Si se requiere v_amortized_amount como columna propia en sale_returns
  --   para reporting, agregar en una migración futura.
  --
  -- Condiciones para amortizar:
  --   · Existe un receivable activo (NOT IN 'paid','cancelled')
  --   · Hay saldo pendiente (balance_due > 0)
  --   · Hay algo que reembolsar (v_final_refund > 0)
  --
  -- FOR UPDATE: previene que dos devoluciones concurrentes sobre la misma
  -- venta lean el mismo balance_due y amortizen doble.  La fila de sales
  -- ya fue bloqueada antes; este lock sigue el mismo orden FK → no deadlock.

  SELECT id, balance_due, paid_amount, total_amount
    INTO v_receivable_id, v_rec_balance_due, v_rec_paid_amount, v_rec_total_amount
    FROM public.customer_receivables
   WHERE sale_id = p_sale_id AND tenant_id = p_tenant_id
     AND status NOT IN ('paid', 'cancelled')
   FOR UPDATE;

  IF FOUND AND v_rec_balance_due > 0 AND v_final_refund > 0 THEN

    -- La parte del reembolso que cancela deuda (nunca supera balance_due)
    v_amortized_amount := LEAST(v_final_refund, v_rec_balance_due);

    v_new_paid := v_rec_paid_amount + v_amortized_amount;

    -- Determinar nuevo status según saldo resultante
    -- total_amount nunca se toca: CHECK(total_amount > 0) permanece satisfecho
    v_new_rec_status := CASE
      WHEN v_new_paid >= v_rec_total_amount THEN 'paid'
      WHEN v_new_paid >  0                  THEN 'partial'
      ELSE 'pending'
    END;

    UPDATE public.customer_receivables
       SET paid_amount = v_new_paid,
           status      = v_new_rec_status,
           updated_at  = now()
     WHERE id = v_receivable_id AND tenant_id = p_tenant_id;

  END IF;

  -- Lo que no fue absorbido por la deuda sale físicamente
  v_physical_refund := v_final_refund - v_amortized_amount;

  -- ── Cash movement (solo sobre el excedente físico) ─────────────────────
  IF p_cash_session_id IS NOT NULL AND p_refund_method = 'cash' AND v_physical_refund > 0 THEN
    INSERT INTO cash_movements (
      tenant_id, cash_session_id, movement_type, direction,
      amount, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_tenant_id, p_cash_session_id, 'cash_out', -1,
      v_physical_refund, 'Devolución de venta - Efectivo', 'sale_return', v_sale_return_id, v_user_id
    );
  END IF;

  RETURN v_sale_return_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_return FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_sale_return TO authenticated;
