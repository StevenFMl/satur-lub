-- ============================================================
-- v42_backfill_average_cost.sql   (OPCIONAL — ejecutar manualmente)
--
-- NO forma parte de la migración v42_initialize_product_average_cost.sql.
-- El trigger ahí creado solo siembra average_cost/last_purchase_cost
-- en INSERTs nuevos — productos ya existentes con average_cost = 0
-- y cost_price > 0 NO se ven afectados por el trigger.
--
-- Este script aplica la misma semilla a productos YA creados que
-- nunca recibieron una compra (por eso su CPP sigue en 0/NULL).
--
-- SEGURIDAD:
--   - Solo toca filas donde average_cost/last_purchase_cost están
--     en 0 o NULL Y cost_price > 0 — nunca pisa un CPP ya calculado
--     por receive_purchase_order (WAC real de compras recibidas).
--   - Revisa el SELECT de previsualización antes de ejecutar el UPDATE.
--   - Ejecutar dentro de una transacción y revisar el conteo de filas
--     afectadas antes de hacer COMMIT.
-- ============================================================

-- 1) Previsualización — productos candidatos al backfill
SELECT id, tenant_id, name, sku, cost_price, average_cost, last_purchase_cost
  FROM public.products
 WHERE COALESCE(cost_price, 0) > 0
   AND (COALESCE(average_cost, 0) = 0 OR COALESCE(last_purchase_cost, 0) = 0)
 ORDER BY tenant_id, name;

-- 2) Backfill — ejecutar dentro de una transacción
BEGIN;

UPDATE public.products
   SET average_cost = cost_price
 WHERE COALESCE(average_cost, 0) = 0
   AND COALESCE(cost_price, 0) > 0;

UPDATE public.products
   SET last_purchase_cost = cost_price
 WHERE COALESCE(last_purchase_cost, 0) = 0
   AND COALESCE(cost_price, 0) > 0;

-- Revisa el resultado antes de confirmar:
-- SELECT id, name, cost_price, average_cost, last_purchase_cost
--   FROM public.products
--  WHERE COALESCE(cost_price, 0) > 0;

COMMIT;
-- Si algo se ve mal, usar ROLLBACK; en lugar de COMMIT;
