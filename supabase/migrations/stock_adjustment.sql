DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inventory_balances_tenant_warehouse_product_key'
    ) THEN
        ALTER TABLE public.inventory_balances 
        ADD CONSTRAINT inventory_balances_tenant_warehouse_product_key 
        UNIQUE (tenant_id, warehouse_id, product_id);
    END IF;
END $$;

-- 2. Creamos la función RPC para el ajuste de stock
CREATE OR REPLACE FUNCTION public.record_stock_adjustment(
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
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Obtener el tenant_id del usuario
  SELECT tenant_id INTO v_tenant_id
  FROM public.tenant_memberships
  WHERE user_id = p_performed_by_user_id
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autorizado o sin tenant asignado.';
  END IF;

  -- Insertar el movimiento histórico
  INSERT INTO public.inventory_movements (
    tenant_id,
    warehouse_id,
    product_id,
    movement_type,
    quantity,
    unit_cost,
    reason,
    performed_by_user_id
  ) VALUES (
    v_tenant_id,
    p_warehouse_id,
    p_product_id,
    'adjustment',
    p_quantity,
    p_unit_cost,
    p_reason,
    p_performed_by_user_id
  );

  -- Actualizar el saldo físico (UPSERT)
  INSERT INTO public.inventory_balances (
    tenant_id,
    warehouse_id,
    product_id,
    quantity_on_hand
  ) VALUES (
    v_tenant_id,
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

-- 3. Dar permisos para que la aplicación pueda llamar a esta función
GRANT EXECUTE ON FUNCTION public.record_stock_adjustment TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_stock_adjustment TO service_role;
