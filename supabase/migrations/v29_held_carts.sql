-- ============================================================
-- v29_held_carts.sql
--
-- Persists "parked" POS sessions so any active member of the
-- tenant can view, resume, or discard them from any terminal.
--
-- Design decisions:
--   • cart_lines jsonb    — CartLine[] snapshot; prices locked at park time.
--   • customer_snapshot   — PickedCustomer snapshot so holds survive
--                           partner edits or deletions.
--   • gross_amount        — pre-computed total; avoids re-running Big.js
--                           in the list view.
--   • No expiry column    — expiry is a business rule enforced at app level.
--   • Max 5 per tenant    — enforced at app level before INSERT.
-- ============================================================

CREATE TABLE public.held_carts (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant scope
  tenant_id         uuid          NOT NULL
                                  REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Who parked it (snapshot so the display survives user changes)
  created_by        uuid          NOT NULL,   -- auth.users.id
  created_by_name   text,

  -- Customer (optional — some sales have no specific customer)
  customer_id       uuid,                     -- FK hint only; use snapshot for display
  customer_snapshot jsonb,                    -- PickedCustomer at park time

  -- Cart state
  cart_lines        jsonb         NOT NULL,   -- CartLine[] snapshot
  gross_amount      numeric(12,2) NOT NULL DEFAULT 0,
  items_count       int           NOT NULL DEFAULT 0,

  -- Optional cashier note
  note              text,

  created_at        timestamptz   NOT NULL DEFAULT now()
);

-- ── Index ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_held_carts_tenant_at
  ON public.held_carts (tenant_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.held_carts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'held_carts' AND policyname = 'held_carts_tenant_members'
  ) THEN
    CREATE POLICY "held_carts_tenant_members" ON public.held_carts
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id   = auth.uid()
             AND is_active = true
        )
      )
      WITH CHECK (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id   = auth.uid()
             AND is_active = true
        )
      );
  END IF;
END $$;
