-- ============================================================
-- v31_patch_tenant_sri_credentials.sql
--
-- Non-destructive patch on tenant_sri_credentials.
-- Does NOT recreate the table nor drop any data.
--
-- Changes:
--   1. password_sri_encrypted  bytea NULL → text NULL
--      (safe: column is NULL in all rows at time of patch)
--   2. Add optional metadata columns if absent
--   3. Add FK to tenants if absent
--   4. Drop over-permissive INSERT/UPDATE policies
--      (all writes go via service_role / createAdminClient)
-- ============================================================

-- ── Safety pre-check ──────────────────────────────────────────────────────
-- Abort if any row already has non-NULL bytea data that we cannot safely
-- convert without knowing the original encoding.
DO $$
DECLARE
  cnt integer;
BEGIN
  SELECT COUNT(*) INTO cnt
    FROM public.tenant_sri_credentials
   WHERE password_sri_encrypted IS NOT NULL;

  IF cnt > 0 THEN
    RAISE EXCEPTION
      'v31 pre-check failed: % row(s) have non-NULL password_sri_encrypted. '
      'Inspect and convert manually before applying this migration.',
      cnt;
  END IF;
END $$;

-- ── 1. bytea → text ───────────────────────────────────────────────────────
-- Column is NULL in all rows (verified above), so the USING clause is
-- a no-op fallback.  Changing the type is zero-risk.
ALTER TABLE public.tenant_sri_credentials
  ALTER COLUMN password_sri_encrypted
    TYPE text
    USING (
      CASE WHEN password_sri_encrypted IS NULL
           THEN NULL
           ELSE convert_from(password_sri_encrypted, 'UTF8')
      END
    );

-- ── 2. Optional metadata columns ─────────────────────────────────────────
-- Used by the certificate upload UI (future).  Not read by cert.ts today.
ALTER TABLE public.tenant_sri_credentials
  ADD COLUMN IF NOT EXISTS cert_subject text,
  ADD COLUMN IF NOT EXISTS cert_expiry  date,
  ADD COLUMN IF NOT EXISTS uploaded_by  uuid;   -- auth.users.id of uploader

-- ── 3. FK to tenants (ON DELETE CASCADE) ─────────────────────────────────
-- Guards orphaned credentials when a tenant is deleted.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_schema    = 'public'
       AND table_name      = 'tenant_sri_credentials'
       AND constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE public.tenant_sri_credentials
      ADD CONSTRAINT fk_tenant_sri_cred_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES public.tenants(id)
        ON DELETE CASCADE;
  END IF;
END $$;

-- ── 4. Harden RLS — drop over-permissive write policies ──────────────────
-- Certificates are sensitive material.  Client code must never INSERT or
-- UPDATE this table directly.  All writes go through createAdminClient()
-- (service_role), which bypasses RLS entirely.
--
-- Keeping SELECT so that admins can verify a cert has been uploaded
-- from a server component without needing service_role for reads.
DROP POLICY IF EXISTS "insert_sri_credentials" ON public.tenant_sri_credentials;
DROP POLICY IF EXISTS "update_sri_credentials" ON public.tenant_sri_credentials;
