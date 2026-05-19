-- ============================================================
-- v28_document_events.sql
--
-- Minimal audit trail for document generation and downloads.
--
-- Columns:
--   doc_type   : 'xml' | 'pdf' | 'ride_html' | 'ticket' | 'a4'
--   event_type : 'generate' | 'download' | 'storage_upload'
--   status     : 'ok' | 'error'
--   storage_path: populated on successful Storage upload
--
-- Insert is always via service_role (createAdminClient) — no
-- client-side INSERT policy is needed or wanted.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.document_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant scope (required — all queries are tenant-scoped)
  tenant_id    uuid        NOT NULL
                             REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Document identity (at most one of these is set per event)
  invoice_id   uuid        REFERENCES public.electronic_invoices(id) ON DELETE SET NULL,
  sale_id      uuid        REFERENCES public.sales(id)               ON DELETE SET NULL,

  -- Actor (nullable — system events may have no user)
  user_id      uuid,       -- auth.users.id; no FK to avoid cascade headaches

  -- What happened
  doc_type     text        NOT NULL,
  event_type   text        NOT NULL,
  status       text        NOT NULL DEFAULT 'ok',
  error_msg    text,
  storage_path text,

  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Patch path (idempotent column additions for existing envs) ─────────────
ALTER TABLE public.document_events
  ADD COLUMN IF NOT EXISTS invoice_id   uuid,
  ADD COLUMN IF NOT EXISTS sale_id      uuid,
  ADD COLUMN IF NOT EXISTS user_id      uuid,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS error_msg    text;

-- ── Domain CHECK constraints ───────────────────────────────────────────────
-- Guard invalid values at the DB layer so application bugs can't corrupt
-- the audit log with unrecognised categories.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.document_events'::regclass
       AND conname  = 'chk_document_events_doc_type'
  ) THEN
    ALTER TABLE public.document_events
      ADD CONSTRAINT chk_document_events_doc_type
        CHECK (doc_type IN ('xml', 'pdf', 'ride_html', 'ticket', 'a4'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.document_events'::regclass
       AND conname  = 'chk_document_events_event_type'
  ) THEN
    ALTER TABLE public.document_events
      ADD CONSTRAINT chk_document_events_event_type
        CHECK (event_type IN ('generate', 'download', 'storage_upload'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.document_events'::regclass
       AND conname  = 'chk_document_events_status'
  ) THEN
    ALTER TABLE public.document_events
      ADD CONSTRAINT chk_document_events_status
        CHECK (status IN ('ok', 'error'));
  END IF;
END $$;

-- ── Indexes ────────────────────────────────────────────────────────────────

-- Latest events per tenant (dashboard / admin list)
CREATE INDEX IF NOT EXISTS idx_document_events_tenant_created
  ON public.document_events (tenant_id, created_at DESC);

-- Events for a specific invoice across time
-- (most useful: "show all downloads of factura 001-001-000042")
CREATE INDEX IF NOT EXISTS idx_document_events_tenant_invoice
  ON public.document_events (tenant_id, invoice_id, created_at DESC)
  WHERE invoice_id IS NOT NULL;

-- Events for a specific sale across time
-- (less frequent but needed for sale detail audit panel)
CREATE INDEX IF NOT EXISTS idx_document_events_tenant_sale
  ON public.document_events (tenant_id, sale_id, created_at DESC)
  WHERE sale_id IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.document_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'document_events'
       AND policyname = 'document_events_select'
  ) THEN
    CREATE POLICY "document_events_select"
    ON public.document_events
    FOR SELECT
    USING (
      tenant_id IN (
        SELECT tenant_id FROM public.tenant_memberships
         WHERE user_id = auth.uid() AND is_active = true
      )
    );
  END IF;
END $$;

-- ── Verification ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_has_doc_type_chk  boolean;
  v_has_event_chk     boolean;
  v_has_status_chk    boolean;
  v_has_rls           boolean;
  v_has_select_policy boolean;
BEGIN
  SELECT TRUE INTO v_has_doc_type_chk
    FROM pg_constraint
   WHERE conrelid = 'public.document_events'::regclass
     AND conname  = 'chk_document_events_doc_type';

  SELECT TRUE INTO v_has_event_chk
    FROM pg_constraint
   WHERE conrelid = 'public.document_events'::regclass
     AND conname  = 'chk_document_events_event_type';

  SELECT TRUE INTO v_has_status_chk
    FROM pg_constraint
   WHERE conrelid = 'public.document_events'::regclass
     AND conname  = 'chk_document_events_status';

  SELECT relrowsecurity INTO v_has_rls
    FROM pg_class
   WHERE oid = 'public.document_events'::regclass;

  SELECT TRUE INTO v_has_select_policy
    FROM pg_policies
   WHERE tablename = 'document_events'
     AND policyname = 'document_events_select';

  IF v_has_doc_type_chk IS NOT TRUE THEN
    RAISE EXCEPTION 'v28 FAILED: chk_document_events_doc_type constraint missing.';
  END IF;
  IF v_has_event_chk IS NOT TRUE THEN
    RAISE EXCEPTION 'v28 FAILED: chk_document_events_event_type constraint missing.';
  END IF;
  IF v_has_status_chk IS NOT TRUE THEN
    RAISE EXCEPTION 'v28 FAILED: chk_document_events_status constraint missing.';
  END IF;
  IF v_has_rls IS NOT TRUE THEN
    RAISE EXCEPTION 'v28 FAILED: RLS not enabled on document_events.';
  END IF;
  IF v_has_select_policy IS NOT TRUE THEN
    RAISE EXCEPTION 'v28 FAILED: tenant-scoped SELECT policy missing.';
  END IF;

  RAISE NOTICE 'v28 OK: document_events — tabla + 3 CHECK constraints + 3 indexes + RLS + SELECT policy activos.';
END $$;
