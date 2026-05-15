-- v17_cost_capture.sql
-- Captura el CPP (average_cost) vigente en cada producto en el momento exacto
-- en que se inserta una línea de venta.
--
-- ESTRATEGIA: trigger BEFORE INSERT en sale_items, no modifica el RPC create_sale.
-- Esto evita duplicar o alterar el RPC de 400+ líneas y funciona para cualquier
-- camino de inserción (create_sale, create_sale_return, etc.).
--
-- REGLA DE COSTO:
--   1. Si unit_cost ya viene con valor (> 0), se respeta (override explícito).
--   2. Si unit_cost = NULL → se copia products.average_cost del instante.
--   3. Si products.average_cost = 0 (servicio o producto sin compras) → unit_cost = 0.
--
-- COMPATIBILIDAD HISTÓRICA:
--   Las filas antiguas conservan unit_cost = NULL.
--   El reporte de rentabilidad distingue NULL (fuente: CPP actual) de 0 (fuente: sin costo).

-- ── Función del trigger ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.capture_sale_item_unit_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo actúa cuando unit_cost no fue provisto explícitamente
  IF NEW.unit_cost IS NULL THEN
    SELECT COALESCE(average_cost, 0)
      INTO NEW.unit_cost
      FROM public.products
     WHERE id         = NEW.product_id
       AND tenant_id  = NEW.tenant_id;

    -- Si el producto no se encuentra (eliminado), deja 0
    IF NOT FOUND THEN
      NEW.unit_cost := 0;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Trigger ───────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_sale_items_capture_cost ON public.sale_items;

CREATE TRIGGER trg_sale_items_capture_cost
  BEFORE INSERT ON public.sale_items
  FOR EACH ROW
  EXECUTE FUNCTION public.capture_sale_item_unit_cost();

-- ── Permisos ──────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.capture_sale_item_unit_cost() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.capture_sale_item_unit_cost() TO service_role;
