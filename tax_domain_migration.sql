-- ==============================================================================
-- 1. CREACIÓN DE COLUMNAS PARA IVA BOOLEANO
-- ==============================================================================

-- Añadir has_tax a productos
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS has_tax boolean not null default true;

-- Poblar datos históricos
UPDATE public.products SET has_tax = (tax_rate > 0);

-- Blindar Kárdex y ventas futuras
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS is_taxable boolean not null default true;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS is_taxable boolean not null default true;

-- Añadir tax_rate por default en la cabecera de la orden
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS tax_rate numeric(5,2) default 15.00;
ALTER TABLE public.purchase_orders ALTER COLUMN tax_rate SET DEFAULT 15.00;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS is_tax_inclusive boolean not null default true;

-- ==============================================================================
-- 2. CORRECCIÓN DE SEGURIDAD RPC: Resolución Explícita del Tenant + IVA Booleano
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- receive_purchase_order
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, uuid, text, text, date, text, jsonb, numeric, numeric, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, uuid, uuid, text, text, date, text, jsonb, numeric, numeric, numeric, numeric, numeric);

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_tenant_id        uuid,
  p_supplier_id      uuid,
  p_warehouse_id     uuid,
  p_payment_method   text,
  p_payment_status   text,
  p_payment_due_date date,
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
    payment_method, payment_status, payment_due_date
  ) VALUES (
    p_tenant_id, p_supplier_id, p_warehouse_id,
    p_subtotal, p_tax_amount, p_grand_total,
    p_tax_rate, p_is_tax_inclusive, p_tax_amount, p_grand_total, p_other_charges,
    'received', p_notes, v_user_id,
    p_payment_method, v_pay_status,
    CASE WHEN p_payment_method = 'credit' THEN p_payment_due_date ELSE NULL END
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

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, uuid, uuid, text, text, date, text, jsonb, numeric, boolean, numeric, numeric, numeric, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, uuid, uuid, text, text, date, text, jsonb, numeric, boolean, numeric, numeric, numeric, numeric) TO authenticated;
