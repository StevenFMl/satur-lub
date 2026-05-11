-- ============================================================
-- v2_create_sale_rpc.sql
-- Transactional RPC for POS sale creation.
--
-- Responsibilities:
--   1. Validates auth and tenant membership.
--   2. Validates customer, warehouse, items (stock check).
--   3. Re-reads PUBLICO prices from DB (server-authoritative).
--   4. Inserts sale header, items, inventory movements, payment.
--   5. Updates inventory_balances (decrement).
--   6. Returns new sale.id.
--
-- Price convention:
--   product_prices.unit_price = GROSS (IVA included).
--   sale_items.unit_price     = GROSS (same).
--   sale_items.line_total     = GROSS (qty * unit_price - discount).
--   sales.subtotal            = NET base (gross extracted).
--   sales.tax_total           = IVA extracted from gross.
--   sales.total               = GROSS total (= subtotal + tax_total).
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_sale(
  p_tenant_id     uuid,
  p_customer_id   uuid,
  p_warehouse_id  uuid,        -- NULL = no inventory tracking
  p_items         jsonb,       -- [{product_id, quantity, discount_amount?}]
  p_payments      jsonb,       -- [{method, amount, reference?}]
  p_notes         text     DEFAULT NULL,
  p_document_kind text     DEFAULT 'ticket'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        uuid;
  v_sale_id        uuid;
  v_tier_id        uuid;
  v_item           jsonb;
  v_payment        jsonb;
  -- item-level
  v_product_id     uuid;
  v_quantity       numeric(12,4);
  v_discount       numeric(12,2);
  v_unit_price     numeric(12,2);
  v_tax_rate       numeric(5,2);
  v_has_tax        boolean;
  v_track_inv      boolean;
  v_line_gross     numeric(12,2);
  v_line_net       numeric(12,2);
  v_line_iva       numeric(12,2);
  v_product_name   text;
  v_stock_avail    numeric(12,2);
  -- accumulators
  v_total_gross    numeric(12,2) := 0;
  v_total_net      numeric(12,2) := 0;
  v_total_iva      numeric(12,2) := 0;
  v_total_disc     numeric(12,2) := 0;
  v_pmt_total      numeric(12,2) := 0;
BEGIN
  -- ── Auth ────────────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships
     WHERE tenant_id = p_tenant_id
       AND user_id   = v_user_id
       AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Sin acceso a este tenant.';
  END IF;

  -- ── Validate customer ────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM business_partners
     WHERE id         = p_customer_id
       AND tenant_id  = p_tenant_id
       AND is_active  = true
  ) THEN
    RAISE EXCEPTION 'Cliente no encontrado o inactivo.';
  END IF;

  -- ── Validate warehouse ───────────────────────────────────────────
  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM warehouses
     WHERE id        = p_warehouse_id
       AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Bodega no válida.';
  END IF;

  -- ── Items required ───────────────────────────────────────────────
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta requiere al menos un ítem.';
  END IF;

  -- ── PUBLICO price tier ───────────────────────────────────────────
  SELECT id INTO v_tier_id
  FROM   price_tiers
  WHERE  tenant_id = p_tenant_id
    AND  code      = 'PUBLICO'
  LIMIT  1;
  -- v_tier_id may be NULL if not yet seeded; prices will fall back to default_price.

  -- ── Pre-validate stock (fail-fast before any writes) ────────────
  IF p_warehouse_id IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity   := (v_item->>'quantity')::numeric;

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

        IF v_stock_avail < v_quantity THEN
          RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %.',
            v_product_name, v_stock_avail, v_quantity;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- ── Insert sale header (totals will be updated at end) ───────────
  INSERT INTO sales (
    tenant_id, customer_id, warehouse_id, created_by_user_id,
    document_kind, status, notes,
    subtotal, discount_total, tax_total, total
  )
  VALUES (
    p_tenant_id,
    p_customer_id,
    p_warehouse_id,
    v_user_id,
    COALESCE(p_document_kind, 'ticket'),
    'confirmed',
    p_notes,
    0, 0, 0, 0
  )
  RETURNING id INTO v_sale_id;

  -- ── Insert items ─────────────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::numeric;
    v_discount   := COALESCE((v_item->>'discount_amount')::numeric, 0);

    -- Server-authoritative: read PUBLICO price; fall back to default_price.
    SELECT
      COALESCE(pp.unit_price, p.default_price, 0),
      COALESCE(p.tax_rate, 15),
      COALESCE(p.has_tax, true),
      COALESCE(p.track_inventory, true)
    INTO v_unit_price, v_tax_rate, v_has_tax, v_track_inv
    FROM products p
    LEFT JOIN product_prices pp
           ON pp.product_id    = p.id
          AND pp.price_tier_id = v_tier_id
          AND pp.valid_to      IS NULL
          AND pp.tenant_id     = p_tenant_id
    WHERE p.id        = v_product_id
      AND p.tenant_id = p_tenant_id;

    -- Gross line total (cannot be negative; discount capped at gross before discount)
    v_line_gross := GREATEST(ROUND(v_quantity * v_unit_price - v_discount, 2), 0);
    v_total_disc := v_total_disc + v_discount;

    -- Extract net base and IVA from gross price
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
      tenant_id, sale_id, product_id,
      quantity, unit_price, discount_amount,
      tax_rate, line_total, is_taxable
    )
    VALUES (
      p_tenant_id, v_sale_id, v_product_id,
      v_quantity, v_unit_price, v_discount,
      CASE WHEN v_has_tax THEN v_tax_rate ELSE 0 END,
      v_line_gross,
      v_has_tax
    );

    -- Inventory tracking
    IF v_track_inv AND p_warehouse_id IS NOT NULL THEN
      INSERT INTO inventory_movements (
        tenant_id, warehouse_id, product_id,
        movement_type, quantity, reason, direction,
        reference_type, reference_id, performed_by_user_id
      )
      VALUES (
        p_tenant_id, p_warehouse_id, v_product_id,
        'sale', v_quantity, 'Venta POS', -1,
        'sale', v_sale_id, v_user_id
      );

      UPDATE inventory_balances
         SET quantity_on_hand = quantity_on_hand - v_quantity,
             updated_at       = now()
       WHERE tenant_id    = p_tenant_id
         AND warehouse_id = p_warehouse_id
         AND product_id   = v_product_id;
    END IF;
  END LOOP;

  -- ── Update sale totals ───────────────────────────────────────────
  UPDATE sales
     SET subtotal       = v_total_net,
         discount_total = v_total_disc,
         tax_total      = v_total_iva,
         total          = v_total_gross
   WHERE id = v_sale_id;

  -- ── Insert payments ──────────────────────────────────────────────
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_pmt_total := v_pmt_total + COALESCE((v_payment->>'amount')::numeric, 0);

    INSERT INTO sale_payments (
      tenant_id, sale_id, payment_method, amount, reference
    )
    VALUES (
      p_tenant_id,
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::numeric,
      v_payment->>'reference'
    );
  END LOOP;

  -- Payment must cover the total (1-cent tolerance for rounding)
  IF v_pmt_total < v_total_gross - 0.01 THEN
    RAISE EXCEPTION 'Pago insuficiente: pagado $%, total $%.', v_pmt_total, v_total_gross;
  END IF;

  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_sale TO authenticated;
