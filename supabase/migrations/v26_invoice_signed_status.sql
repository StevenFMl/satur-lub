-- ============================================================
-- v26_invoice_signed_status.sql
--
-- Adds 'signed' to the electronic_invoices status lifecycle.
--
-- The signing step (XAdES-BES) can succeed independently of the
-- SRI submission. Persisting the signed XML before sending allows:
--   - Retry of the SRI submission without re-signing
--   - Audit of what was signed vs what was sent
--   - Detection of sign/send failures independently
--
-- Lifecycle update:
--   draft → signed → sent → authorized
--                         → rejected
--   (any) → cancelled
--
-- The existing CHECK constraint is dropped and recreated to add 'signed'.
-- DROP CONSTRAINT is safe here because:
--   1. The old constraint only prevented invalid states (no rows have
--      invalid values — all existing rows have: draft, sent, authorized,
--      rejected, or cancelled).
--   2. The new constraint is a superset of the old one plus 'signed'.
--   3. Both operations run in the same transaction (DDL in PostgreSQL
--      is transactional), so the table is never unconstrained.
--
-- Idempotency: guarded by checking pg_constraint before drop/recreate.
-- ============================================================

DO $$
BEGIN
  -- Only proceed if the 'signed' value is NOT already in the constraint.
  -- We detect this by checking whether the constraint source includes 'signed'.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.electronic_invoices'::regclass
       AND c.conname  = 'electronic_invoices_status_check'
       AND pg_get_constraintdef(c.oid) LIKE '%signed%'
  ) THEN
    -- Drop the old constraint (name was set by CREATE TABLE in v25)
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.electronic_invoices'::regclass
         AND conname  = 'electronic_invoices_status_check'
    ) THEN
      ALTER TABLE public.electronic_invoices
        DROP CONSTRAINT electronic_invoices_status_check;
      RAISE NOTICE 'v26: removed old status CHECK constraint.';
    END IF;

    -- Add new constraint with 'signed' included
    ALTER TABLE public.electronic_invoices
      ADD CONSTRAINT electronic_invoices_status_check
        CHECK (status IN ('draft','signed','sent','authorized','rejected','cancelled'));

    RAISE NOTICE 'v26: status CHECK now includes ''signed''.';
  ELSE
    RAISE NOTICE 'v26: ''signed'' already present in status CHECK — no change.';
  END IF;
END $$;

-- Verification
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.electronic_invoices'::regclass
       AND c.conname  = 'electronic_invoices_status_check'
       AND pg_get_constraintdef(c.oid) LIKE '%signed%'
  ) THEN
    RAISE EXCEPTION 'v26 FAILED: ''signed'' not in status constraint.';
  END IF;

  RAISE NOTICE 'v26 OK: electronic_invoices.status permite draft/signed/sent/authorized/rejected/cancelled.';
END $$;
