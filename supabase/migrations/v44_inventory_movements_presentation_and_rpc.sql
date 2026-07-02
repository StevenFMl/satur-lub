-- Migration: Add presentation_id to inventory_movements and update create_sale RPC to persist it
-- Path: supabase/migrations/v44_inventory_movements_presentation_and_rpc.sql

-- ── 1. Add presentation_id column to inventory_movements ─────────────────
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS presentation_id uuid
    REFERENCES public.product_presentations(id)
    ON DELETE SET NULL;

COMMENT ON COLUMN public.inventory_movements.presentation_id IS 
  'La presentación comercial en la que se realizó el movimiento de inventario (NULL = unidad base).';

-- ── 2. Update create_sale RPC function to insert presentation_id ─────────
DROP FUNCTION IF EXISTS public.create_sale(uuid, uuid, uuid, jsonb, jsonb, text, text, date, uuid, boolean, numeric, text, text, date, text, boolean, numeric, uuid, uuid);

CREATE OR REPLACE FUNCTION public.create_sale(
  p_tenant_id                  uuid,
  p_customer_id                uuid,
  p_warehouse_id               uuid,
  p_items                      jsonb,
  p_payments                   jsonb,
  p_notes                      text    DEFAULT NULL,
  p_document_kind              text    DEFAULT 'ticket',
  p_sale_date                  date    DEFAULT NULL,
  p_cash_session_id            uuid    DEFAULT NULL,
  p_is_credit                  boolean DEFAULT false,
  p_initial_payment            numeric DEFAULT NULL,
  p_initial_payment_method     text    DEFAULT NULL,
  p_initial_payment_ref        text    DEFAULT NULL,
  p_due_date                   date    DEFAULT NULL,
  p_credit_notes               text    DEFAULT NULL,
  p_below_cost_override        boolean DEFAULT false,
  p_below_cost_loss_estimated  numeric DEFAULT NULL,
  p_idempotency_key            uuid    DEFAULT NULL,
  p_vehicle_id                 uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           uuid;
  v_sale_id           uuid;
  v_tier_id           uuid;
  v_is_privileged     boolean;
  v_item              jsonb;
  v_payment           jsonb;
  v_comp              jsonb;
  -- item-level
  v_product_id        uuid;
  v_presentation_id   uuid;
  v_quantity          numeric(12,4);
  v_base_qty          numeric(12,4);
  v_inv_qty           numeric(12,4);
  v_discount          numeric(12,2);
  v_unit_price        numeric(12,2);
  v_original_price    numeric(12,2);
  v_override_price    numeric(12,2);
  v_override_type     text;
  v_override_reason   text;
  v_override_note     text;
  v_tax_rate          numeric(5,2);
  v_has_tax           boolean;
  v_track_inv         boolean;
  v_line_gross        numeric(12,2);
  v_line_net          numeric(12,2);
  v_line_iva          numeric(12,2);
  v_product_name      text;
  v_stock_avail       numeric(12,2);
  v_unit_cost         numeric(12,2);
  v_is_kit            boolean;
  -- bundle / kit variables
  v_components        jsonb;
  v_comp_product_id   uuid;
  v_comp_quantity     numeric(12,4);
  v_comp_base_qty     numeric(12,4);
  v_comp_inv_qty      numeric(12,4);
  v_comp_track_inv    boolean;
  v_comp_name         text;
  v_kit_name          text;
  -- kit/bundle parent validation
  v_parent_kind       text;
  v_parent_track_inv  boolean;
  -- accumulators
  v_total_gross       numeric(12,2) := 0;
  v_total_net         numeric(12,2) := 0;
  v_total_iva         numeric(12,2) := 0;
  v_total_disc        numeric(12,2) := 0;
  v_pmt_total         numeric(12,2) := 0;
  v_cash_total        numeric(12,2) := 0;
  v_sess_status       text;
  v_sess_wh_id        uuid;
  v_credit_status     text;
BEGIN
  -- ── Auth + tenant membership ──────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  SELECT CASE WHEN role IN ('owner','admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM tenant_memberships
   WHERE tenant_id = p_tenant_id AND user_id = v_user_id AND is_active = true;

  IF v_is_privileged IS NULL THEN RAISE EXCEPTION 'Sin acceso a este tenant.'; END IF;

  -- ── Idempotency check (after auth, before any writes) ────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_sale_id
      FROM public.sales
     WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN v_sale_id;
    END IF;
  END IF;

  -- ── Cash session validation ───────────────────────────────────────────
  IF p_cash_session_id IS NOT NULL THEN
    SELECT status, warehouse_id INTO v_sess_status, v_sess_wh_id
      FROM cash_sessions WHERE id = p_cash_session_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de caja no encontrada.'; END IF;
    IF v_sess_status <> 'open' THEN RAISE EXCEPTION 'La sesión de caja no está abierta.'; END IF;
    IF NOT (
      (v_sess_wh_id IS NULL     AND p_warehouse_id IS NULL) OR
      (v_sess_wh_id IS NOT NULL AND p_warehouse_id IS NOT NULL AND v_sess_wh_id = p_warehouse_id)
    ) THEN
      RAISE EXCEPTION 'La sesión de caja no corresponde a la bodega de esta venta.';
    END IF;
  END IF;

  -- ── Validate customer + warehouse ─────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM business_partners
     WHERE id = p_customer_id AND tenant_id = p_tenant_id AND is_active = true
  ) THEN RAISE EXCEPTION 'Cliente no encontrado o inactivo.'; END IF;

  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM warehouses WHERE id = p_warehouse_id AND tenant_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'Bodega no válida.'; END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta requiere al menos un ítem.';
  END IF;

  -- ── Validate vehicle belongs to customer (if provided) ───────────────
  IF p_vehicle_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.vehicles
       WHERE id        = p_vehicle_id
         AND tenant_id = p_tenant_id
         AND partner_id = p_customer_id
         AND is_active = true
    ) THEN
      RAISE EXCEPTION 'El vehículo no pertenece a este cliente o no está activo.';
    END IF;
  END IF;

  -- ── Credit validations ────────────────────────────────────────────────
  IF p_is_credit THEN
    IF p_initial_payment IS NULL OR p_initial_payment < 0 THEN
      RAISE EXCEPTION 'Pago inicial inválido para venta fiada.';
    END IF;
    IF p_initial_payment > 0 AND p_initial_payment_method NOT IN ('cash','card','transfer') THEN
      RAISE EXCEPTION 'Método de pago inicial inválido.';
    END IF;
  END IF;

  SELECT id INTO v_tier_id FROM price_tiers
   WHERE tenant_id = p_tenant_id AND code = 'PUBLICO' LIMIT 1;

  -- ── Pre-validate stock (fail-fast — no writes yet) ────────────────────
  IF p_warehouse_id IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := NULLIF(v_item->>'product_id', '')::uuid;

      IF v_product_id IS NULL THEN
        CONTINUE;
      END IF;

      v_quantity   := (v_item->>'quantity')::numeric;
      v_components := v_item->'components';

      IF v_components IS NOT NULL
         AND jsonb_typeof(v_components) = 'array'
         AND jsonb_array_length(v_components) > 0
      THEN
        SELECT p.product_kind, p.track_inventory
          INTO v_parent_kind, v_parent_track_inv
          FROM products p
         WHERE p.id = v_product_id AND p.tenant_id = p_tenant_id AND p.is_active = true;

        IF v_parent_kind NOT IN ('kit', 'bundle') THEN
          RAISE EXCEPTION
            'El ítem % tiene componentes pero product_kind = "%" (se requiere "kit" o "bundle").',
            v_product_id, COALESCE(v_parent_kind, 'NULL');
        END IF;

        IF COALESCE(v_parent_track_inv, false) = true THEN
          RAISE EXCEPTION
            'El kit/bundle % tiene track_inventory = true. Estos productos no deben llevar inventario propio.',
            v_product_id;
        END IF;

        FOR v_comp IN SELECT * FROM jsonb_array_elements(v_components) LOOP
          v_comp_product_id := (v_comp->>'product_id')::uuid;
          v_comp_quantity   := (v_comp->>'quantity')::numeric * v_quantity;
          v_comp_base_qty   := COALESCE((v_comp->>'base_qty')::numeric, 1);
          v_comp_inv_qty    := v_comp_quantity * v_comp_base_qty;

          SELECT p.track_inventory, p.name
            INTO v_comp_track_inv, v_comp_name
            FROM products p
           WHERE p.id = v_comp_product_id AND p.tenant_id = p_tenant_id AND p.is_active = true;

          IF v_comp_name IS NULL THEN
            RAISE EXCEPTION 'Componente de kit no encontrado: %', v_comp_product_id;
          END IF;

          IF v_comp_track_inv THEN
            SELECT COALESCE(quantity_on_hand, 0) INTO v_stock_avail
              FROM inventory_balances
             WHERE product_id = v_comp_product_id
               AND warehouse_id = p_warehouse_id
               AND tenant_id = p_tenant_id;
            v_stock_avail := COALESCE(v_stock_avail, 0);
            IF v_stock_avail < v_comp_inv_qty THEN
              RAISE EXCEPTION 'Stock insuficiente para componente "%": disponible %, solicitado %.',
                v_comp_name, v_stock_avail, v_comp_inv_qty;
            END IF;
          END IF;
        END LOOP;

      ELSE
        v_base_qty := COALESCE((v_item->>'base_qty')::numeric, 1);
        v_inv_qty  := v_quantity * v_base_qty;

        SELECT p.track_inventory, p.name INTO v_track_inv, v_product_name
          FROM products p
         WHERE p.id = v_product_id AND p.tenant_id = p_tenant_id AND p.is_active = true;

        IF v_product_name IS NULL THEN
          RAISE EXCEPTION 'Producto % no encontrado o inactivo.', v_product_id;
        END IF;

        IF v_track_inv THEN
          SELECT COALESCE(quantity_on_hand, 0) INTO v_stock_avail
            FROM inventory_balances
           WHERE product_id = v_product_id AND warehouse_id = p_warehouse_id AND tenant_id = p_tenant_id;
          v_stock_avail := COALESCE(v_stock_avail, 0);
          IF v_stock_avail < v_inv_qty THEN
            RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %.',
              v_product_name, v_stock_avail, v_inv_qty;
          END IF;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── Insert sale header ────────────────────────────────────────────────
  INSERT INTO sales (
    tenant_id, customer_id, warehouse_id, created_by_user_id,
    document_kind, status, notes, sale_date,
    subtotal, discount_total, tax_total, total,
    below_cost_override, below_cost_loss_estimated,
    idempotency_key, vehicle_id
  ) VALUES (
    p_tenant_id, p_customer_id, p_warehouse_id, v_user_id,
    COALESCE(p_document_kind, 'ticket'), 'confirmed', p_notes,
    COALESCE(p_sale_date, CURRENT_DATE), 0, 0, 0, 0,
    p_below_cost_override, p_below_cost_loss_estimated,
    p_idempotency_key, p_vehicle_id
  ) RETURNING id INTO v_sale_id;

  -- ── Insert items + inventory decrements ──────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id      := NULLIF(v_item->>'product_id', '')::uuid;
    v_presentation_id := NULLIF(v_item->>'presentation_id', '')::uuid;
    v_quantity        := (v_item->>'quantity')::numeric;
    v_base_qty        := COALESCE((v_item->>'base_qty')::numeric, 1);
    v_inv_qty         := v_quantity * v_base_qty;
    v_discount        := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_override_price  := NULLIF(v_item->>'override_unit_price', '')::numeric;
    v_override_type   := v_item->>'price_override_type';
    v_override_reason := v_item->>'price_override_reason';
    v_override_note   := v_item->>'price_override_note';
    v_components      := v_item->'components';
    v_is_kit          := false;

    IF v_product_id IS NOT NULL THEN
      SELECT COALESCE(pres.unit_price, pp.unit_price, p.default_price, 0),
             COALESCE(p.tax_rate, 15), COALESCE(p.has_tax, true),
             COALESCE(p.track_inventory, true), p.name, p.product_kind = 'kit' OR p.product_kind = 'bundle'
        INTO v_unit_price, v_tax_rate, v_has_tax, v_track_inv, v_product_name, v_is_kit
        FROM products p
        LEFT JOIN product_prices pp
               ON pp.product_id = p.id AND pp.price_tier_id = v_tier_id
              AND pp.valid_to IS NULL AND pp.tenant_id = p_tenant_id
        LEFT JOIN product_presentations pres
               ON pres.id = v_presentation_id AND pres.product_id = p.id
              AND pres.tenant_id = p_tenant_id AND pres.is_active = true
       WHERE p.id = v_product_id AND p.tenant_id = p_tenant_id;

      v_unit_cost := NULL; -- captured by trigger (v17/v33)
    ELSE
      v_product_name := COALESCE(NULLIF(trim(v_item->>'name'), ''), 'Ítem manual');
      v_unit_price   := COALESCE((v_item->>'unit_price')::numeric, 0);
      v_has_tax      := COALESCE((v_item->>'has_tax')::boolean, false);
      v_tax_rate     := CASE WHEN v_has_tax THEN COALESCE((v_item->>'tax_rate')::numeric, 15) ELSE 0 END;
      v_track_inv    := false;
      v_unit_cost    := NULLIF(v_item->>'average_cost', '')::numeric;
    END IF;

    v_kit_name := v_product_name;

    -- ── Override validation ──────────────────────────────────────────
    IF v_override_price IS NOT NULL THEN
      IF v_override_price < 0 THEN
        RAISE EXCEPTION 'Precio de ajuste no puede ser negativo para "%".', v_product_name;
      END IF;
      IF trim(COALESCE(v_override_reason, '')) = '' THEN
        RAISE EXCEPTION 'Se requiere una razón al ajustar el precio de "%".', v_product_name;
      END IF;
      IF v_product_id IS NOT NULL AND NOT v_is_privileged AND v_unit_price > 0 THEN
        IF v_override_price < v_unit_price * 0.70 THEN
          RAISE EXCEPTION 'Descuento máximo permitido es 30%% del precio de lista para "%".', v_product_name;
        END IF;
      END IF;
      v_original_price := v_unit_price;
      v_unit_price     := v_override_price;
    ELSE
      v_original_price := NULL;
    END IF;

    -- ── Line totals ──────────────────────────────────────────────────
    v_line_gross := GREATEST(ROUND(v_quantity * v_unit_price - v_discount, 2), 0);
    v_total_disc := v_total_disc + v_discount;

    IF v_has_tax AND v_tax_rate > 0 THEN
      v_line_net := ROUND(v_line_gross / (1 + v_tax_rate / 100), 2);
      v_line_iva := ROUND(v_line_gross - v_line_net, 2);
    ELSE
      v_line_net := v_line_gross;
      v_line_iva := 0;
    END IF;

    v_total_gross := v_total_gross + v_line_gross;
    v_total_net   := v_total_net   + v_line_net;
    v_total_iva   := v_total_iva   + v_line_iva;

    -- ── sale_items row ────────────────────────────────────────────────
    INSERT INTO sale_items (
      tenant_id, sale_id, product_id, item_name, presentation_id, base_qty,
      quantity, unit_price, discount_amount, tax_rate, line_total, is_taxable,
      original_unit_price, price_override_type, price_override_reason, price_override_note,
      price_override_by, price_override_at, unit_cost, is_kit
    ) VALUES (
      p_tenant_id, v_sale_id, v_product_id, v_product_name, v_presentation_id, v_base_qty,
      v_quantity, v_unit_price, v_discount,
      CASE WHEN v_has_tax THEN v_tax_rate ELSE 0 END,
      v_line_gross, v_has_tax, v_original_price,
      v_override_type, v_override_reason, v_override_note,
      CASE WHEN v_original_price IS NOT NULL THEN v_user_id ELSE NULL END,
      CASE WHEN v_original_price IS NOT NULL THEN now()     ELSE NULL END,
      v_unit_cost, v_is_kit
    );

    -- ── Inventory: kit/bundle vs regular ────────────────────────────
    IF v_product_id IS NOT NULL THEN
      IF v_components IS NOT NULL
         AND jsonb_typeof(v_components) = 'array'
         AND jsonb_array_length(v_components) > 0
      THEN
        FOR v_comp IN SELECT * FROM jsonb_array_elements(v_components) LOOP
          v_comp_product_id := (v_comp->>'product_id')::uuid;
          v_comp_quantity   := (v_comp->>'quantity')::numeric * v_quantity;
          v_comp_base_qty   := COALESCE((v_comp->>'base_qty')::numeric, 1);
          v_comp_inv_qty    := v_comp_quantity * v_comp_base_qty;

          SELECT COALESCE(p.track_inventory, true)
            INTO v_comp_track_inv
            FROM products p
           WHERE p.id = v_comp_product_id AND p.tenant_id = p_tenant_id;

          IF v_comp_track_inv AND p_warehouse_id IS NOT NULL THEN
            INSERT INTO inventory_movements (
              tenant_id, warehouse_id, product_id, movement_type, quantity, reason,
              direction, reference_type, reference_id, performed_by_user_id
            ) VALUES (
              p_tenant_id, p_warehouse_id, v_comp_product_id,
              'sale', v_comp_inv_qty,
              'Venta kit: ' || COALESCE(v_kit_name, ''),
              -1, 'sale', v_sale_id, v_user_id
            );
            UPDATE inventory_balances
               SET quantity_on_hand = quantity_on_hand - v_comp_inv_qty, updated_at = now()
             WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id
               AND product_id = v_comp_product_id;
          END IF;
        END LOOP;

      ELSE
        IF v_track_inv AND p_warehouse_id IS NOT NULL THEN
          -- PERSISTIR PRESENTATION_ID EN INVENTORY_MOVEMENTS
          INSERT INTO inventory_movements (
            tenant_id, warehouse_id, product_id, movement_type, quantity, reason,
            direction, reference_type, reference_id, performed_by_user_id, presentation_id
          ) VALUES (
            p_tenant_id, p_warehouse_id, v_product_id, 'sale', v_inv_qty, 'Venta POS',
            -1, 'sale', v_sale_id, v_user_id, v_presentation_id
          );
          UPDATE inventory_balances
             SET quantity_on_hand = quantity_on_hand - v_inv_qty, updated_at = now()
           WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id AND product_id = v_product_id;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- ── Update sale totals ────────────────────────────────────────────────
  UPDATE sales
     SET subtotal = v_total_net, discount_total = v_total_disc,
         tax_total = v_total_iva, total = v_total_gross
   WHERE id = v_sale_id;

  -- ── Payments (credit vs normal) ───────────────────────────────────────
  IF p_is_credit THEN
    IF p_initial_payment > v_total_gross THEN
      RAISE EXCEPTION 'El pago inicial ($%) supera el total de la venta ($%).',
        p_initial_payment, v_total_gross;
    END IF;
    IF p_initial_payment > 0 THEN
      INSERT INTO sale_payments (tenant_id, sale_id, payment_method, amount, reference)
      VALUES (p_tenant_id, v_sale_id, p_initial_payment_method, p_initial_payment,
              NULLIF(trim(COALESCE(p_initial_payment_ref, '')), ''));
      IF p_initial_payment_method = 'cash' AND p_cash_session_id IS NOT NULL THEN
        INSERT INTO cash_movements (
          tenant_id, cash_session_id, movement_type, direction,
          amount, reason, reference_type, reference_id, created_by
        ) VALUES (
          p_tenant_id, p_cash_session_id, 'cash_in', 1,
          p_initial_payment, 'Abono inicial fiado', 'sale', v_sale_id, v_user_id
        );
      END IF;
    END IF;
    IF p_initial_payment >= v_total_gross THEN v_credit_status := 'paid';
    ELSIF p_initial_payment > 0              THEN v_credit_status := 'partial';
    ELSE                                          v_credit_status := 'pending';
    END IF;
    INSERT INTO customer_receivables (
      tenant_id, sale_id, customer_id, total_amount, paid_amount, status,
      due_date, notes, created_by
    ) VALUES (
      p_tenant_id, v_sale_id, p_customer_id,
      v_total_gross, COALESCE(p_initial_payment, 0), v_credit_status,
      p_due_date, NULLIF(trim(COALESCE(p_credit_notes, '')), ''), v_user_id
    );
  ELSE
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
      v_pmt_total := v_pmt_total + (v_payment->>'amount')::numeric;
      INSERT INTO sale_payments (tenant_id, sale_id, payment_method, amount, reference)
      VALUES (
        p_tenant_id, v_sale_id, v_payment->>'method', (v_payment->>'amount')::numeric,
        NULLIF(trim(COALESCE(v_payment->>'reference', '')), '')
      );
      IF v_payment->>'method' = 'cash' THEN
        v_cash_total := v_cash_total + (v_payment->>'amount')::numeric;
      END IF;
    END LOOP;

    IF ABS(v_pmt_total - v_total_gross) > 0.01 THEN
      RAISE EXCEPTION 'Monto pagado ($%) no coincide con el total de la venta ($%).',
        v_pmt_total, v_total_gross;
    END IF;

    IF v_cash_total > 0 AND p_cash_session_id IS NOT NULL THEN
      INSERT INTO cash_movements (
        tenant_id, cash_session_id, movement_type, direction,
        amount, reason, reference_type, reference_id, created_by
      ) VALUES (
        p_tenant_id, p_cash_session_id, 'cash_in', 1,
        v_cash_total, 'Venta POS', 'sale', v_sale_id, v_user_id
      );
    END IF;
  END IF;

  RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sale(uuid, uuid, uuid, jsonb, jsonb, text, text, date, uuid, boolean, numeric, text, text, date, text, boolean, numeric, uuid, uuid) TO authenticated;
