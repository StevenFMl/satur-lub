-- =========================================================================
-- I. ANULACIÓN DE COMPRAS · RPC TRANSACCIONAL
-- =========================================================================
-- cancel_purchase_order: Revierte una OC recibida.
--   1. Valida que la OC exista, pertenezca al tenant del usuario y esté 'received'.
--   2. Cambia el estado a 'cancelled'.
--   3. Por cada ítem, inserta un inventory_movement de tipo 'adjustment' (negativo).
--   4. Resta quantity_on_hand en inventory_balances.
--   5. Todo en una sola transacción — si algo falla, nada queda a medias.

CREATE OR REPLACE FUNCTION public.cancel_purchase_order(p_po_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_tenant_id   uuid;
  v_warehouse_id uuid;
  v_status      text;
  v_item        record;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  -- Resolver tenant activo (owner/admin)
  SELECT tenant_id INTO v_tenant_id
    FROM public.tenant_memberships
   WHERE user_id = v_user_id
     AND is_active = true
     AND role IN ('owner', 'admin')
   ORDER BY is_owner DESC
   LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Sin tenant activo o sin permisos';
  END IF;

  -- Validar la OC
  SELECT status, warehouse_id
    INTO v_status, v_warehouse_id
    FROM public.purchase_orders
   WHERE id = p_po_id
     AND tenant_id = v_tenant_id;

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
     AND tenant_id = v_tenant_id;

  -- 2. Por cada ítem: movimiento de ajuste + actualizar balance
  FOR v_item IN
    SELECT product_id, quantity, unit_cost
      FROM public.purchase_order_items
     WHERE purchase_order_id = p_po_id
       AND tenant_id = v_tenant_id
  LOOP
    -- Movimiento de ajuste (reversa)
    INSERT INTO public.inventory_movements (
      tenant_id, warehouse_id, product_id,
      movement_type, quantity, unit_cost, reason,
      reference_type, reference_id, performed_by_user_id
    ) VALUES (
      v_tenant_id, v_warehouse_id, v_item.product_id,
      'adjustment', v_item.quantity, v_item.unit_cost,
      'Anulación de compra',
      'purchase_order', p_po_id, v_user_id
    );

    -- Restar del balance (solo si hay bodega asignada)
    IF v_warehouse_id IS NOT NULL THEN
      UPDATE public.inventory_balances
         SET quantity_on_hand = quantity_on_hand - v_item.quantity,
             updated_at = now()
       WHERE tenant_id = v_tenant_id
         AND warehouse_id = v_warehouse_id
         AND product_id = v_item.product_id;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_purchase_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_order(uuid) TO authenticated;
