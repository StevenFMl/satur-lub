-- ============================================================
-- v3_product_presentations.sql
--
-- 1. product_presentations — unidades / presentaciones de venta.
--    Permite vender un producto en distintas presentaciones
--    (galón, caneca, litro, cuarto) con conversión a unidad base.
--    El inventario siempre se mantiene en la UNIDAD BASE del producto.
--
-- 2. sale_items: agrega presentation_id + base_qty para rastrear
--    cuántas unidades base se descontaron del stock por línea.
--
-- 3. sales: agrega sale_date (fecha real de venta, separada de
--    created_at) para soportar carga histórica y corrección de fecha.
--
-- 4. Actualiza create_sale RPC:
--    - Acepta p_sale_date y presentation_id / base_qty por ítem.
--    - Decrementa stock usando quantity × base_qty.
-- ============================================================

-- ── 1. product_presentations ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.product_presentations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
  product_id  uuid        NOT NULL,
  name        text        NOT NULL,          -- interno, p.ej. "galon", "caneca_5g"
  unit_label  text        NOT NULL,          -- display, p.ej. "Galón", "Caneca 5 gal"
  base_qty    numeric(12,4) NOT NULL DEFAULT 1,  -- cuántas unidades base contiene 1 de esta presentación
  unit_price  numeric(12,2),                 -- NULL = usar precio PUBLICO del producto
  sku         text,                          -- SKU opcional por presentación
  is_default  boolean     NOT NULL DEFAULT false,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (tenant_id, product_id)
    REFERENCES public.products(tenant_id, id)
    ON DELETE CASCADE,

  UNIQUE (tenant_id, product_id, name)
);

CREATE INDEX IF NOT EXISTS idx_presentations_product
  ON public.product_presentations(tenant_id, product_id);

ALTER TABLE public.product_presentations ENABLE ROW LEVEL SECURITY;

-- RLS: solo miembros del tenant
CREATE POLICY "pres_tenant_access" ON public.product_presentations
  FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
       WHERE user_id  = auth.uid()
         AND is_active = true
    )
  );

-- ── 2. sale_items: presentación y cantidad base ─────────────────

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS presentation_id uuid
    REFERENCES public.product_presentations(id)
    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_qty numeric(12,4) NOT NULL DEFAULT 1;

-- ── 3. sales: fecha real de venta ──────────────────────────────

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_date date;

COMMENT ON COLUMN public.sales.sale_date IS
  'Fecha real de la venta (puede diferir de created_at en cargas históricas).
   NULL = usa created_at como referencia.';

-- ── 4. create_sale — reemplazar con soporte de presentaciones ───

CREATE OR REPLACE FUNCTION public.create_sale(
  p_tenant_id      uuid,
  p_customer_id    uuid,
  p_warehouse_id   uuid,
  p_items          jsonb,   -- [{product_id, quantity, discount_amount?, presentation_id?, base_qty?}]
  p_payments       jsonb,   -- [{method, amount, reference?}]
  p_notes          text     DEFAULT NULL,
  p_document_kind  text     DEFAULT 'ticket',
  p_sale_date      date     DEFAULT NULL       -- NULL = fecha de hoy
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
  v_item             jsonb;
  v_payment          jsonb;
  -- item-level
  v_product_id       uuid;
  v_presentation_id  uuid;
  v_quantity         numeric(12,4);
  v_base_qty         numeric(12,4);
  v_inv_qty          numeric(12,4);   -- quantity × base_qty → stock decrement
  v_discount         numeric(12,2);
  v_unit_price       numeric(12,2);
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

  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships
     WHERE tenant_id = p_tenant_id
       AND user_id   = v_user_id
       AND is_active = true
  ) THEN
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

  -- ── Pre-validate stock (fail-fast) ────────────────────────────
  IF p_warehouse_id IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id      := (v_item->>'product_id')::uuid;
      v_quantity        := (v_item->>'quantity')::numeric;
      v_base_qty        := COALESCE((v_item->>'base_qty')::numeric, 1);
      v_inv_qty         := v_quantity * v_base_qty;

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
    p_tenant_id,
    p_customer_id,
    p_warehouse_id,
    v_user_id,
    COALESCE(p_document_kind, 'ticket'),
    'confirmed',
    p_notes,
    COALESCE(p_sale_date, CURRENT_DATE),
    0, 0, 0, 0
  )
  RETURNING id INTO v_sale_id;

  -- ── Insert items ──────────────────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id      := (v_item->>'product_id')::uuid;
    v_presentation_id := (v_item->>'presentation_id')::uuid;   -- may be NULL
    v_quantity        := (v_item->>'quantity')::numeric;
    v_base_qty        := COALESCE((v_item->>'base_qty')::numeric, 1);
    v_inv_qty         := v_quantity * v_base_qty;
    v_discount        := COALESCE((v_item->>'discount_amount')::numeric, 0);

    -- Server-authoritative price:
    -- Priority: presentation.unit_price > PUBLICO tier > products.default_price > 0
    SELECT
      COALESCE(pres.unit_price, pp.unit_price, p.default_price, 0),
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
    LEFT JOIN product_presentations pres
           ON pres.id          = v_presentation_id
          AND pres.product_id  = p.id
          AND pres.tenant_id   = p_tenant_id
          AND pres.is_active   = true
    WHERE p.id        = v_product_id
      AND p.tenant_id = p_tenant_id;

    -- Gross line total (cannot be negative; discount capped at gross amount)
    v_line_gross := GREATEST(ROUND(v_quantity * v_unit_price - v_discount, 2), 0);
    v_total_disc := v_total_disc + v_discount;

    -- Extract net and IVA from gross
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
      tax_rate, line_total, is_taxable
    )
    VALUES (
      p_tenant_id, v_sale_id, v_product_id, v_presentation_id, v_base_qty,
      v_quantity, v_unit_price, v_discount,
      CASE WHEN v_has_tax THEN v_tax_rate ELSE 0 END,
      v_line_gross,
      v_has_tax
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
