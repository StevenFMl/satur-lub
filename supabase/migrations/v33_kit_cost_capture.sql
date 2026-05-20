-- ============================================================
-- v33_kit_cost_capture.sql
--
-- Fixes cost capture for kit / bundle products in sale_items.
--
-- ROOT CAUSE:
--   The trigger capture_sale_item_unit_cost (v17) copies
--   products.average_cost directly.  Kits/bundles have
--   average_cost = 0 (they are virtual — no stock, no direct
--   purchase cost), so every kit sale recorded unit_cost = $0,
--   yielding 100% fictitious margin in the rentabilidad dashboard.
--
-- FIX:
--   If the inserted product is a kit or bundle, compute the
--   consolidated cost by summing each component's contribution:
--
--     unit_cost_kit = SUM( bi.quantity × bi.base_qty × p.average_cost )
--
--   This mirrors the inventory-deduction formula used in create_sale
--   (v14/v21), ensuring cost and stock move by the same quantities.
--   Components without a recorded cost contribute 0 (COALESCE).
--
-- BACKWARD COMPATIBILITY:
--   · Regular products:     behaviour identical to v17.
--   · Manual items (no product_id / not found in products):
--     NOT FOUND branch sets unit_cost = 0, same as v17.
--   · Kit with no bundle_items configured:
--     SUM over empty set → COALESCE → 0.  Safe.
--   · unit_cost already set explicitly (> 0 override):
--     outer IF NEW.unit_cost IS NULL guard skips the function,
--     same as v17.
--
-- TRIGGER BINDING:
--   CREATE OR REPLACE FUNCTION replaces the function body in
--   place.  The existing trigger trg_sale_items_capture_cost
--   (BEFORE INSERT ON sale_items) already points to this
--   function and does not need to be recreated.
-- ============================================================

CREATE OR REPLACE FUNCTION public.capture_sale_item_unit_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_kind text;
  v_direct_cost  numeric(12,4);  -- average_cost from products row (regular path)
BEGIN
  -- Guard: if unit_cost was provided explicitly, respect it.
  IF NEW.unit_cost IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Single query: fetch product_kind and average_cost in one round-trip.
  SELECT COALESCE(p.product_kind, 'regular'),
         COALESCE(p.average_cost, 0)
    INTO v_product_kind, v_direct_cost
    FROM public.products p
   WHERE p.id        = NEW.product_id
     AND p.tenant_id = NEW.tenant_id;

  -- Product not found (deleted product, manual item with NULL product_id, etc.)
  IF NOT FOUND THEN
    NEW.unit_cost := 0;
    RETURN NEW;
  END IF;

  IF v_product_kind IN ('kit', 'bundle') THEN
    -- ── Kit / bundle: consolidated cost from components ───────────────
    --
    -- Formula:  unit_cost_kit = SUM( bi.quantity × bi.base_qty × p.average_cost )
    --
    -- bi.quantity   — component presentation-units required per kit unit
    -- bi.base_qty   — conversion factor: presentation → base units
    -- p.average_cost — CPP of the component in base units
    --
    -- Indexed access via idx_bundle_items_bundle(tenant_id, bundle_product_id).
    SELECT COALESCE(
             SUM(bi.quantity * bi.base_qty * COALESCE(p.average_cost, 0)),
             0
           )
      INTO NEW.unit_cost
      FROM public.bundle_items bi
      JOIN public.products p
        ON p.id        = bi.component_product_id
       AND p.tenant_id = NEW.tenant_id
     WHERE bi.bundle_product_id = NEW.product_id
       AND bi.tenant_id         = NEW.tenant_id;

  ELSE
    -- ── Regular product: copy CPP directly (v17 behaviour) ───────────
    NEW.unit_cost := v_direct_cost;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.capture_sale_item_unit_cost() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.capture_sale_item_unit_cost() TO service_role;
