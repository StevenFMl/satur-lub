-- ============================================================
-- v30_tenant_sri_credentials.sql
--
-- Per-tenant SRI signing certificate storage.
--
-- The .p12 binary lives in the private Supabase Storage bucket
-- "sri-certificates" (one object per tenant).  Only the storage
-- key is kept here.
--
-- The certificate password is stored AES-256-CBC encrypted:
--   format: "<iv_hex>:<ciphertext_base64>"
--   key:    SHA-256(SRI_CRYPTO_SECRET env var)
-- The plaintext password NEVER appears in the database.
--
-- Uniqueness: one active credential per tenant (UNIQUE on tenant_id).
-- Rotation: UPDATE the existing row to swap in a new certificate.
-- ============================================================

CREATE TABLE public.tenant_sri_credentials (
  id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid         NOT NULL UNIQUE
                                       REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Key within the "sri-certificates" Storage bucket
  -- e.g. "<tenant_id>/cert.p12"
  p12_storage_key        text         NOT NULL,

  -- AES-256-CBC encrypted password: "<iv_hex>:<ciphertext_base64>"
  password_sri_encrypted text         NOT NULL,

  -- Informational metadata (not used for signing — derived from the cert itself)
  cert_subject           text,
  cert_expiry            date,
  uploaded_by            uuid,        -- auth.users.id of who uploaded this cert

  created_at             timestamptz  NOT NULL DEFAULT now(),
  updated_at             timestamptz  NOT NULL DEFAULT now()
);

-- ── Index ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_tenant_sri_credentials_tenant
  ON public.tenant_sri_credentials (tenant_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Credentials are sensitive.  No direct client-side access allowed.
-- All reads/writes go through server-side service_role (createAdminClient).
--
-- A SELECT-only policy is added so that admins/owners can verify whether
-- a certificate has been uploaded (without exposing the key material).

ALTER TABLE public.tenant_sri_credentials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'tenant_sri_credentials'
       AND policyname = 'sri_cred_owner_select'
  ) THEN
    CREATE POLICY "sri_cred_owner_select" ON public.tenant_sri_credentials
      FOR SELECT
      TO authenticated
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id   = auth.uid()
             AND is_active = true
        )
      );
  END IF;
END $$;
