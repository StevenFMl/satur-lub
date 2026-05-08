-- ==============================================================================
-- 1. BLINDAJE DEL KARDEX: Columna 'direction' y 'purchase_cancel'
-- ==============================================================================

-- Remover la restricción actual de movement_type para expandirla
ALTER TABLE public.inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_movement_type_check;

-- Volver a crear la restricción incluyendo 'purchase_cancel'
ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check 
  CHECK (movement_type IN ('in', 'out', 'adjustment', 'sale', 'purchase', 'transfer', 'purchase_cancel'));

-- Añadir la columna 'direction' obligatoria. 
-- Usamos DEFAULT 1 temporalmente para que las filas existentes no fallen al crearse.
ALTER TABLE public.inventory_movements 
  ADD COLUMN IF NOT EXISTS direction numeric(2,0) NOT NULL DEFAULT 1 CHECK (direction IN (1, -1));

-- (Opcional) Si existen datos antiguos que fueron de resta, habría que actualizar su direction a -1, 
-- pero asumiremos default 1 por ahora para mantener la integridad de la migración.

-- ==============================================================================
-- 2. CORRECCIÓN DE SEGURIDAD RPC: Resolución Explícita del Tenant
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- A. record_stock_adjustment
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_stock_adjustment(uuid, uuid, numeric, numeric, text, uuid);

CREATE OR REPLACE FUNCTION public.record_stock_adjustment(
  p_tenant_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_reason text,
  p_performed_by_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validaciones básicas
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;

  -- 2. Insertar el movimiento de inventario ('adjustment' sumando)
  INSERT INTO public.inventory_movements (
    tenant_id,
    warehouse_id,
    product_id,
    movement_type,
    quantity,
    unit_cost,
    reason,
    performed_by_user_id,
    direction
  ) VALUES (
    p_tenant_id,
    p_warehouse_id,
    p_product_id,
    'adjustment',
    p_quantity,
    p_unit_cost,
    p_reason,
    p_performed_by_user_id,
    1 -- direction: Entrada
  );

  -- 3. Actualizar el saldo (inventory_balances) usando UPSERT
  INSERT INTO public.inventory_balances (
    tenant_id,
    warehouse_id,
    product_id,
    quantity_on_hand
  ) VALUES (
    p_tenant_id,
    p_warehouse_id,
    p_product_id,
    p_quantity
  )
  ON CONFLICT (tenant_id, warehouse_id, product_id)
  DO UPDATE SET 
    quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
    updated_at = now();

END;
$$;

-- ------------------------------------------------------------------------------
-- B. receive_purchase_order
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.receive_purchase_order(uuid, uuid, text, text, date, text, jsonb, numeric, numeric, numeric, numeric, numeric);

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
    tax_rate, tax_amount, grand_total, other_charges,
    status, notes, created_by,
    payment_method, payment_status, payment_due_date
  ) VALUES (
    p_tenant_id, p_supplier_id, p_warehouse_id,
    p_subtotal, p_tax_amount, p_grand_total,
    p_tax_rate, p_tax_amount, p_grand_total, p_other_charges,
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
      quantity, unit_cost, line_total
    ) VALUES (
      p_tenant_id, v_po_id, v_product_id,
      v_qty, v_unit_cost, v_line_total
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

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, uuid, uuid, text, text, date, text, jsonb, numeric, numeric, numeric, numeric, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, uuid, uuid, text, text, date, text, jsonb, numeric, numeric, numeric, numeric, numeric) TO authenticated;

-- ------------------------------------------------------------------------------
-- C. cancel_purchase_order
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_purchase_order(uuid);

CREATE OR REPLACE FUNCTION public.cancel_purchase_order(p_tenant_id uuid, p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_warehouse_id uuid;
  v_status      text;
  v_item        record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;

  -- Validar la OC
  SELECT status, warehouse_id
    INTO v_status, v_warehouse_id
    FROM public.purchase_orders
   WHERE id = p_po_id
     AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;

  IF v_status <> 'received' THEN
    RAISE EXCEPTION 'Solo se pueden anular órdenes en estado "received". Estado actual: %', v_status;
  END IF;

  -- 1. Marcar como cancelada
  UPDATE public.purchase_orders
     SET status = 'cancelled'
   WHERE id = p_po_id
     AND tenant_id = p_tenant_id;

  -- 2. Por cada ítem: movimiento de ajuste (resta) + actualizar balance
  FOR v_item IN
    SELECT product_id, quantity, unit_cost
      FROM public.purchase_order_items
     WHERE purchase_order_id = p_po_id
       AND tenant_id = p_tenant_id
  LOOP
    -- Movimiento de ajuste (reversa)
    INSERT INTO public.inventory_movements (
      tenant_id, warehouse_id, product_id,
      movement_type, quantity, unit_cost, reason,
      reference_type, reference_id, performed_by_user_id, direction
    ) VALUES (
      p_tenant_id, v_warehouse_id, v_item.product_id,
      'purchase_cancel', v_item.quantity, v_item.unit_cost,
      'Anulación de compra',
      'purchase_order', p_po_id, v_user_id, -1
    );

    -- Restar del balance (solo si hay bodega asignada)
    IF v_warehouse_id IS NOT NULL THEN
      UPDATE public.inventory_balances
         SET quantity_on_hand = quantity_on_hand - v_item.quantity,
             updated_at = now()
       WHERE tenant_id = p_tenant_id
         AND warehouse_id = v_warehouse_id
         AND product_id = v_item.product_id;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(uuid, uuid) TO authenticated;
