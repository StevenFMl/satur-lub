-- ============================================================
-- v42_initialize_product_average_cost.sql
--
-- PROBLEMA:
--   Al crear un producto nuevo con cost_price > 0, las columnas
--   average_cost y last_purchase_cost quedan en 0 / NULL. El CPP
--   recién se inicializa en la primera compra recibida — hasta
--   entonces, el costo de venta (capture_sale_item_unit_cost, v17)
--   captura 0, y reportes de rentabilidad muestran margen ficticio
--   del 100% para productos vendidos sin compra previa registrada.
--
-- FIX:
--   Trigger BEFORE INSERT en products que siembra average_cost y
--   last_purchase_cost desde cost_price cuando llegan en 0/NULL y
--   cost_price > 0. Es solo una SEMILLA inicial — el flujo de
--   compras (receive_purchase_order, v1) sigue siendo la única
--   fuente de verdad para recalcular el CPP real vía WAC.
--
-- ALCANCE:
--   - Solo aplica en INSERT (altas nuevas). No toca productos
--     existentes — para eso ver el script de backfill opcional
--     v42_backfill_average_cost.sql (NO incluido en esta migración).
--   - cost_price siempre se almacena NETO (sin IVA) — invariante
--     ya vigente y sin cambios. Esta semilla hereda ese valor tal cual.
-- ============================================================

CREATE OR REPLACE FUNCTION public.initialize_product_average_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.average_cost, 0) = 0 AND COALESCE(NEW.cost_price, 0) > 0 THEN
    NEW.average_cost := NEW.cost_price;
  END IF;

  IF COALESCE(NEW.last_purchase_cost, 0) = 0 AND COALESCE(NEW.cost_price, 0) > 0 THEN
    NEW.last_purchase_cost := NEW.cost_price;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_initialize_average_cost ON public.products;

CREATE TRIGGER trg_products_initialize_average_cost
  BEFORE INSERT ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.initialize_product_average_cost();

REVOKE EXECUTE ON FUNCTION public.initialize_product_average_cost() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.initialize_product_average_cost() TO service_role;
