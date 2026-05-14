-- ============================================================
-- v16_reorder_point.sql
--
-- Adds reorder_point to products:
--   · Default 0 = no minimum configured (no alert triggered).
--   · Idempotent: ADD COLUMN IF NOT EXISTS.
--   · No RLS change — covered by existing products policies.
--
-- Semantics:
--   reorder_point = 0 → never alert (user hasn't configured a minimum)
--   reorder_point > 0 → alert when quantity_on_hand <= reorder_point
--
-- Phase-2 fields (not added yet, leave space for them):
--   lead_time_days   integer  DEFAULT 0   -- days until delivery after PO
--   safety_stock     numeric  DEFAULT 0   -- buffer above reorder_point
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS reorder_point numeric(12,4) NOT NULL DEFAULT 0
  CONSTRAINT chk_reorder_point_nonneg CHECK (reorder_point >= 0);

COMMENT ON COLUMN public.products.reorder_point IS
  'Minimum stock level that triggers a reorder alert. 0 = no minimum configured.';
