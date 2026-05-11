-- ============================================================
-- v5_void_sale.sql
--
-- 1. sales: cancellation audit columns.
-- 2. Indexes for daily queries / status.
-- 3. inventory_movements: allow sale_reversal in movement_type.
-- 4. void_sale RPC: atomic void + inventory reversal.
-- 5. v_sales_list view: tenant-safe lightweight list/history view.
-- ============================================================

-- ── 1. Cancellation audit columns on sales ──────────────────

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancellation_note text;

-- Optional FK if your schema uses composite tenant-aware references elsewhere.
-- Uncomment only if you want hard FK enforcement and the target composite key exists exactly as expected.
-- ALTER TABLE public.sales
--   ADD CONSTRAINT fk_sales_cancelled_by
--   FOREIGN KEY (tenant_id, cancelled_by)
--   REFERENCES public.tenant_memberships(tenant_id, user_id)
--   ON DELETE RESTRICT;

-- ── 2. Indexes for daily queries ────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sales_sale_date
  ON public.sales(tenant_id, sale_date);

CREATE INDEX IF NOT EXISTS idx_sales_status
  ON public.sales(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_sales_cancelled_at
  ON public.sales(tenant_id, cancelled_at);

-- ── 3. inventory_movements: allow sale_reversal ─────────────
-- Only needed if movement_type is enforced by CHECK constraint.
-- If your DB already allows this value, this block is harmless.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_movements_movement_type_check'
  ) THEN
    ALTER TABLE public.inventory_movements
      DROP CONSTRAINT inventory_movements_movement_type_check;

    ALTER TABLE public.inventory_movements
      ADD CONSTRAINT inventory_movements_movement_type_check
      CHECK (
        movement_type IN (
          'in',
          'out',
          'adjustment',
          'sale',
          'sale_reversal',
          'purchase',
          'transfer'
        )
      );
  END IF;
END $$;

-- ── 4. void_sale RPC ────────────────────────────────────────

DROP FUNCTION IF EXISTS public.void_sale(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.void_sale(
  p_tenant_id uuid,
  p_sale_id   uuid,
  p_reason    text,
  p_note      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       uuid;
  v_is_privileged boolean;
  v_sale_status   text;
  v_warehouse_id  uuid;
  v_item          record;
  v_inv_qty       numeric(12,4);
BEGIN
  -- ── Auth ───────────────────────────────────────────────────
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado.';
  END IF;

  -- ── Role check ─────────────────────────────────────────────
  SELECT CASE WHEN role IN ('owner', 'admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM public.tenant_memberships
   WHERE tenant_id = p_tenant_id
     AND user_id   = v_user_id
     AND is_active = true;

  IF v_is_privileged IS NULL THEN
    RAISE EXCEPTION 'Sin acceso a este tenant.';
  END IF;

  IF NOT v_is_privileged THEN
    RAISE EXCEPTION 'Sin permisos para anular ventas.';
  END IF;

  -- ── Reason required ────────────────────────────────────────
  IF trim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Se requiere un motivo para anular la venta.';
  END IF;

  -- ── Load + lock sale row ───────────────────────────────────
  SELECT status, warehouse_id
    INTO v_sale_status, v_warehouse_id
    FROM public.sales
   WHERE id        = p_sale_id
     AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada.';
  END IF;

  IF v_sale_status = 'cancelled' THEN
    RAISE EXCEPTION 'La venta ya está anulada.';
  END IF;

  IF v_sale_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Solo se pueden anular ventas confirmadas. Estado actual: %.', v_sale_status;
  END IF;

  -- ── Mark as cancelled ──────────────────────────────────────
  UPDATE public.sales
     SET status              = 'cancelled',
         cancelled_at        = now(),
         cancelled_by        = v_user_id,
         cancellation_reason = trim(p_reason),
         cancellation_note   = NULLIF(trim(COALESCE(p_note, '')), '')
   WHERE id        = p_sale_id
     AND tenant_id = p_tenant_id;

  -- ── Reverse inventory ──────────────────────────────────────
  -- Reverses quantity × base_qty (base units) for tracked items only.
  IF v_warehouse_id IS NOT NULL THEN
    FOR v_item IN
      SELECT
        si.product_id,
        si.quantity,
        COALESCE(si.base_qty, 1) AS base_qty,
        p.track_inventory
      FROM public.sale_items si
      JOIN public.products p
        ON p.id = si.product_id
       AND p.tenant_id = si.tenant_id
     WHERE si.sale_id   = p_sale_id
       AND si.tenant_id = p_tenant_id
    LOOP
      IF v_item.track_inventory THEN
        v_inv_qty := v_item.quantity * v_item.base_qty;

        INSERT INTO public.inventory_movements (
          tenant_id,
          warehouse_id,
          product_id,
          movement_type,
          quantity,
          reason,
          direction,
          reference_type,
          reference_id,
          performed_by_user_id
        )
        VALUES (
          p_tenant_id,
          v_warehouse_id,
          v_item.product_id,
          'sale_reversal',
          v_inv_qty,
          'Anulación de venta',
          1,
          'sale',
          p_sale_id,
          v_user_id
        );

        INSERT INTO public.inventory_balances (
          tenant_id,
          warehouse_id,
          product_id,
          quantity_on_hand
        )
        VALUES (
          p_tenant_id,
          v_warehouse_id,
          v_item.product_id,
          v_inv_qty
        )
        ON CONFLICT (tenant_id, warehouse_id, product_id)
        DO UPDATE SET
          quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
          updated_at = now();
      END IF;
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.void_sale(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_sale(uuid, uuid, text, text) TO authenticated;

-- ── 5. v_sales_list view ────────────────────────────────────
-- Uses security_invoker so underlying RLS is respected.

DROP VIEW IF EXISTS public.v_sales_list;

CREATE VIEW public.v_sales_list
WITH (security_invoker = true)
AS
SELECT
  s.id,
  s.tenant_id,
  s.customer_id,
  bp.full_name       AS customer_name,
  bp.document_number AS customer_document,
  s.warehouse_id,
  s.created_by_user_id,
  s.sale_date,
  s.created_at,
  s.document_kind,
  s.status,
  s.subtotal,
  s.discount_total,
  s.tax_total,
  s.total,
  s.notes,
  s.cancelled_at,
  s.cancelled_by,
  s.cancellation_reason,
  s.cancellation_note
FROM public.sales s
LEFT JOIN public.business_partners bp
       ON bp.id = s.customer_id
      AND bp.tenant_id = s.tenant_id;

GRANT SELECT ON public.v_sales_list TO authenticated;