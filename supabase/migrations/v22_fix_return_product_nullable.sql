-- ============================================================
-- v22_fix_return_product_nullable.sql
--
-- sale_return_items.product_id was defined NOT NULL in v6.
-- v21 made sale_items.product_id nullable for manual/freeform items.
-- Without this fix, returning any sale that includes a manual item
-- (product_id = NULL) causes a NOT NULL constraint violation in the
-- INSERT inside create_sale_return.
--
-- The RPC logic already handles NULL product_id safely:
--   SELECT ... FROM products WHERE id = NULL → no rows
--   → v_si_track_inv stays NULL → IF NULL THEN = IF FALSE THEN
--   → inventory block is skipped automatically
--
-- So the only change needed is dropping the NOT NULL constraint.
-- ============================================================

ALTER TABLE public.sale_return_items
  ALTER COLUMN product_id DROP NOT NULL;
