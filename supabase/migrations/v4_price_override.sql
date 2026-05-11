-- ============================================================
-- v4_price_override.sql
--
-- 1. sale_items: add price override audit columns.
-- 2. create_sale RPC: replace with override logic.
--    - Server reads list price; client may send override_unit_price.
--    - Requires price_override_reason when override present.
--    - Privileged users (owner/admin): unlimited override.
--    - Non-privileged: max 30% discount off list price.
--    - Stores original_unit_price for full audit trail.
-- ============================================================

-- ── 1. Override audit columns ────────────────────────────────

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS original_unit_price   numeric(12,2),
  ADD COLUMN IF NOT EXISTS price_override_type   text,
  ADD COLUMN IF NOT EXISTS price_override_reason text,
  ADD COLUMN IF NOT EXISTS price_override_note   text,
  ADD COLUMN IF NOT EXISTS price_override_by     uuid,
  ADD COLUMN IF NOT EXISTS price_override_at     timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_sale_items_override_type'
  ) THEN
    ALTER TABLE public.sale_items
      ADD CONSTRAINT chk_sale_items_override_type
        CHECK (
          price_override_type IS NULL OR
          price_override_type IN ('price_set','courtesy','combo','rounding','damaged','loyalty')
        );
  END IF;
END $$;

-- ── 2. create_sale ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_sale(
  p_tenant_id      uuid,
  p_customer_id    uuid,
  p_warehouse_id   uuid,
  p_items          jsonb,   -- [{product_id, quantity, discount_amount?,
                             --   presentation_id?, base_qty?,
                             --   override_unit_price?, price_override_type?,
                             --   price_override_reason?, price_override_note?}]
  p_payments       jsonb,   -- [{method, amount, reference?}]
  p_notes          text     DEFAULT NULL,
  p_document_kind  text     DEFAULT 'ticket',
  p_sale_date      date     DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          uuid;
  v_sale_id          uuid;
  v_tier_id          uuid;
  v_is_privileged    boolean;
  v_item             jsonb;
  v_payment          jsonb;
  -- item-level
  v_product_id       uuid;
  v_presentation_id  uuid;
  v_quantity         numeric(12,4);
  v_base_qty         numeric(12,4);
  v_inv_qty          numeric(12,4);
  v_discount         numeric(12,2);
  v_unit_price       numeric(12,2);     -- final price charged
  v_original_price   numeric(12,2);     -- server list price (only when override applied)
  v_override_price   numeric(12,2);
  v_override_type    text;
  v_override_reason  text;
  v_override_note    text;
  v_tax_rate         numeric(5,2);
  v_has_tax          boolean;
  v_track_inv        boolean;
  v_line_gross       numeric(12,2);
  v_line_net         numeric(12,2);
  v_line_iva         numeric(12,2);
  v_product_name     text;
  v_stock_avail      numeric(12,2);
  -- accumulators
  v_total_gross      numeric(12,2) := 0;
  v_total_net        numeric(12,2) := 0;
  v_total_iva        numeric(12,2) := 0;
  v_total_disc       numeric(12,2) := 0;
  v_pmt_total        numeric(12,2) := 0;
BEGIN
  -- ── Auth ──────────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;

  -- ── Tenant membership + role (single query) ───────────────────
  SELECT CASE WHEN role IN ('owner', 'admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM tenant_memberships
   WHERE tenant_id = p_tenant_id
     AND user_id   = v_user_id
     AND is_active = true;

  IF v_is_privileged IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a este tenant.';
  END IF;

  -- ── Validate customer ─────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM business_partners
     WHERE id        = p_customer_id
       AND tenant_id = p_tenant_id
       AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Cliente no encontrado o inactivo.';
  END IF;

  -- ── Validate warehouse ────────────────────────────────────────
  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM warehouses
     WHERE id        = p_warehouse_id
       AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Bodega no válida.';
  END IF;

  -- ── Items required ────────────────────────────────────────────
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta requiere al menos un ítem.';
  END IF;

  -- ── PUBLICO price tier ────────────────────────────────────────
  SELECT id INTO v_tier_id
  FROM   price_tiers
  WHERE  tenant_id = p_tenant_id AND code = 'PUBLICO'
  LIMIT  1;

  -- ── Pre-validate stock (fail-fast before any writes) ──────────
  IF p_warehouse_id IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity   := (v_item->>'quantity')::numeric;
      v_base_qty   := COALESCE((v_item->>'base_qty')::numeric, 1);
      v_inv_qty    := v_quantity * v_base_qty;

      SELECT p.track_inventory, p.name
        INTO v_track_inv, v_product_name
        FROM products p
       WHERE p.id        = v_product_id
         AND p.tenant_id = p_tenant_id
         AND p.is_active = true;

      IF v_product_name IS NULL THEN
        RAISE EXCEPTION 'Producto % no encontrado o inactivo.', v_product_id;
      END IF;

      IF v_track_inv THEN
        SELECT COALESCE(quantity_on_hand, 0)
          INTO v_stock_avail
          FROM inventory_balances
         WHERE product_id   = v_product_id
           AND warehouse_id = p_warehouse_id
           AND tenant_id    = p_tenant_id;

        v_stock_avail := COALESCE(v_stock_avail, 0);

        IF v_stock_avail < v_inv_qty THEN
          RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %.',
            v_product_name, v_stock_avail, v_inv_qty;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── Insert sale header ────────────────────────────────────────
  INSERT INTO sales (
    tenant_id, customer_id, warehouse_id, created_by_user_id,
    document_kind, status, notes, sale_date,
    subtotal, discount_total, tax_total, total
  )
  VALUES (
    p_tenant_id, p_customer_id, p_warehouse_id, v_user_id,
    COALESCE(p_document_kind, 'ticket'), 'confirmed', p_notes,
    COALESCE(p_sale_date, CURRENT_DATE),
    0, 0, 0, 0
  )
  RETURNING id INTO v_sale_id;

  -- ── Insert items ──────────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id      := (v_item->>'product_id')::uuid;
    v_presentation_id := (v_item->>'presentation_id')::uuid;
    v_quantity        := (v_item->>'quantity')::numeric;
    v_base_qty        := COALESCE((v_item->>'base_qty')::numeric, 1);
    v_inv_qty         := v_quantity * v_base_qty;
    v_discount        := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_override_price  := NULLIF(v_item->>'override_unit_price', '')::numeric;
    v_override_type   := v_item->>'price_override_type';
    v_override_reason := v_item->>'price_override_reason';
    v_override_note   := v_item->>'price_override_note';

    -- Server-authoritative base price
    -- Priority: presentation.unit_price > PUBLICO tier > products.default_price > 0
    SELECT
      COALESCE(pres.unit_price, pp.unit_price, p.default_price, 0),
      COALESCE(p.tax_rate, 15),
      COALESCE(p.has_tax, true),
      COALESCE(p.track_inventory, true),
      p.name
    INTO v_unit_price, v_tax_rate, v_has_tax, v_track_inv, v_product_name
    FROM products p
    LEFT JOIN product_prices pp
           ON pp.product_id    = p.id
          AND pp.price_tier_id = v_tier_id
          AND pp.valid_to      IS NULL
          AND pp.tenant_id     = p_tenant_id
    LEFT JOIN product_presentations pres
           ON pres.id          = v_presentation_id
          AND pres.product_id  = p.id
          AND pres.tenant_id   = p_tenant_id
          AND pres.is_active   = true
    WHERE p.id        = v_product_id
      AND p.tenant_id = p_tenant_id;

    -- ── Override validation ──────────────────────────────────────
    IF v_override_price IS NOT NULL THEN
      IF v_override_price < 0 THEN
        RAISE EXCEPTION 'Precio de ajuste no puede ser negativo para "%".', v_product_name;
      END IF;
      IF trim(COALESCE(v_override_reason, '')) = '' THEN
        RAISE EXCEPTION 'Se requiere una razón al ajustar el precio de "%".', v_product_name;
      END IF;
      -- Non-privileged users: max 30% discount off list price
      IF NOT v_is_privileged AND v_unit_price > 0 THEN
        IF v_override_price < v_unit_price * 0.70 THEN
          RAISE EXCEPTION 'Descuento máximo permitido es 30%% del precio de lista para "%".', v_product_name;
        END IF;
      END IF;
      v_original_price := v_unit_price;    -- save for audit
      v_unit_price     := v_override_price;
    ELSE
      v_original_price := NULL;
    END IF;

    -- Gross line total (discount capped; cannot go negative)
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

    INSERT INTO sale_items (
      tenant_id, sale_id, product_id, presentation_id, base_qty,
      quantity, unit_price, discount_amount,
      tax_rate, line_total, is_taxable,
      original_unit_price,
      price_override_type, price_override_reason, price_override_note,
      price_override_by,   price_override_at
    )
    VALUES (
      p_tenant_id, v_sale_id, v_product_id, v_presentation_id, v_base_qty,
      v_quantity, v_unit_price, v_discount,
      CASE WHEN v_has_tax THEN v_tax_rate ELSE 0 END,
      v_line_gross, v_has_tax,
      v_original_price,
      v_override_type, v_override_reason, v_override_note,
      CASE WHEN v_original_price IS NOT NULL THEN v_user_id ELSE NULL END,
      CASE WHEN v_original_price IS NOT NULL THEN now()     ELSE NULL END
    );

    -- Stock decrement: uses quantity × base_qty (base units)
    IF v_track_inv AND p_warehouse_id IS NOT NULL THEN
      INSERT INTO inventory_movements (
        tenant_id, warehouse_id, product_id,
        movement_type, quantity, reason, direction,
        reference_type, reference_id, performed_by_user_id
      )
      VALUES (
        p_tenant_id, p_warehouse_id, v_product_id,
        'sale', v_inv_qty, 'Venta POS', -1,
        'sale', v_sale_id, v_user_id
      );

      UPDATE inventory_balances
         SET quantity_on_hand = quantity_on_hand - v_inv_qty,
             updated_at       = now()
       WHERE tenant_id    = p_tenant_id
         AND warehouse_id = p_warehouse_id
         AND product_id   = v_product_id;
    END IF;
  END LOOP;

  -- ── Update sale totals ────────────────────────────────────────
  UPDATE sales
     SET subtotal       = v_total_net,
         discount_total = v_total_disc,
         tax_total      = v_total_iva,
         total          = v_total_gross
   WHERE id = v_sale_id;

  -- ── Payments ──────────────────────────────────────────────────
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_pmt_total := v_pmt_total + COALESCE((v_payment->>'amount')::numeric, 0);

    INSERT INTO sale_payments (
      tenant_id, sale_id, payment_method, amount, reference
    )
    VALUES (
      p_tenant_id, v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::numeric,
      v_payment->>'reference'
    );
  END LOOP;

  IF v_pmt_total < v_total_gross - 0.01 THEN
    RAISE EXCEPTION 'Pago insuficiente: pagado $%, total $%.', v_pmt_total, v_total_gross;
  END IF;

  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_sale TO authenticated;
