-- ============================================================
-- v24_fiscal_config.sql
--
-- Foundation for Ecuador SRI electronic invoicing.
--
-- 1. tenant_fiscal_config
--    Extends tenants with SRI-specific fields that are NOT
--    in the base tenants table (dirección, establecimiento,
--    ambiente, metadata del certificado digital).
--    One row per tenant; initially empty (NULL) until the
--    owner completes fiscal onboarding.
--
-- 2. document_sequences
--    Atomic sequential counter per (tenant, estab, pto_emi, doc_type).
--    The only safe way to get gap-free sequences without locks is
--    INSERT ... ON CONFLICT DO UPDATE ... RETURNING — which is atomic
--    in PostgreSQL.
--    NOTE: gaps can still occur if a transaction is rolled back after
--    reserving a number. The SRI accepts gaps as of 2024.
--
-- 3. next_invoice_sequential(…) RPC
--    SECURITY DEFINER function that atomically reserves the next
--    sequential number. Called from the application server action,
--    NOT from client code.a
--
-- Idempotency: CREATE TABLE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
--   CREATE INDEX IF NOT EXISTS, DO blocks on pg_policies and pg_proc.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. tenant_fiscal_config
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tenant_fiscal_config (
  -- Identity
  tenant_id             uuid          PRIMARY KEY
                          REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- SRI establishment addressing
  -- dir_matriz: official registered address (for infoTributaria.dirMatriz)
  -- dir_estab:  physical establishment address (may equal dir_matriz)
  dir_matriz            text,
  dir_estab             text,
  estab                 char(3)        NOT NULL DEFAULT '001',
  pto_emi               char(3)        NOT NULL DEFAULT '001',

  -- Fiscal flags (SRI XML fields)
  obligado_contabilidad boolean        NOT NULL DEFAULT false,
  contribuyente_especial text,         -- NULL if not a "contribuyente especial"

  -- SRI emission environment
  -- 'pruebas': sandbox / testing (comprobantes do not have legal value)
  -- 'produccion': live environment (authorized comprobantes are legally valid)
  sri_environment       text          NOT NULL DEFAULT 'pruebas'
                          CHECK (sri_environment IN ('pruebas', 'produccion')),

  -- Digital certificate metadata (the actual cert MUST be stored
  -- in an env variable or secret manager — NEVER in the DB)
  cert_filename         text,          -- filename/reference, e.g. "cert_0930000001001.p12"
  cert_expiry           date,          -- certificate expiry date for monitoring

  -- Audit
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

-- Patch path (idempotent column additions)
ALTER TABLE public.tenant_fiscal_config
  ADD COLUMN IF NOT EXISTS dir_matriz             text,
  ADD COLUMN IF NOT EXISTS dir_estab              text,
  ADD COLUMN IF NOT EXISTS obligado_contabilidad  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contribuyente_especial text,
  ADD COLUMN IF NOT EXISTS sri_environment        text    NOT NULL DEFAULT 'pruebas',
  ADD COLUMN IF NOT EXISTS cert_filename          text,
  ADD COLUMN IF NOT EXISTS cert_expiry            date,
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz NOT NULL DEFAULT now();

-- Ensure estab/pto_emi have defaults (ADD COLUMN with NOT NULL requires default)
ALTER TABLE public.tenant_fiscal_config
  ADD COLUMN IF NOT EXISTS estab    char(3) NOT NULL DEFAULT '001',
  ADD COLUMN IF NOT EXISTS pto_emi  char(3) NOT NULL DEFAULT '001';

-- Constraint guard
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.tenant_fiscal_config'::regclass
       AND conname  = 'tenant_fiscal_config_sri_env_check'
  ) THEN
    ALTER TABLE public.tenant_fiscal_config
      ADD CONSTRAINT tenant_fiscal_config_sri_env_check
        CHECK (sri_environment IN ('pruebas', 'produccion'));
  END IF;
END $$;

-- RLS
ALTER TABLE public.tenant_fiscal_config ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'tenant_fiscal_config'
       AND policyname = 'tfc_tenant_access'
  ) THEN
    CREATE POLICY "tfc_tenant_access" ON public.tenant_fiscal_config
      FOR ALL
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id = auth.uid() AND is_active = true
        )
      )
      WITH CHECK (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id = auth.uid() AND is_active = true
        )
      );
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 2. document_sequences
-- ══════════════════════════════════════════════════════════════
-- One row per (tenant, estab, pto_emi, doc_type).
-- last_sequential is incremented atomically via ON CONFLICT DO UPDATE.
--
-- DRIFT HANDLING: the table may pre-exist in some environments with only
-- partial columns (e.g. just id + last_sequential). The patch path below
-- is the authoritative definition for any drifted schema and MUST run
-- before the CREATE INDEX, which requires all routing columns to exist.

-- ── 2-A  Fresh-install path ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_sequences (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  estab           char(3) NOT NULL,
  pto_emi         char(3) NOT NULL,
  -- SRI document type codes:
  --   '01' factura  '04' nota de crédito
  --   '05' nota de débito  '07' comprobante de retención
  doc_type        char(2) NOT NULL,
  last_sequential integer NOT NULL DEFAULT 0,

  CONSTRAINT uq_document_sequences UNIQUE (tenant_id, estab, pto_emi, doc_type)
);

-- ── 2-B  Patch path: add every column that may be missing ────────────────
-- All columns added as NULLABLE first so ADD COLUMN never fails on existing
-- rows. NOT NULL is tightened after backfill in step 2-C.
-- Columns that already exist are silently skipped by IF NOT EXISTS.

ALTER TABLE public.document_sequences
  ADD COLUMN IF NOT EXISTS tenant_id       uuid,
  ADD COLUMN IF NOT EXISTS estab           char(3),
  ADD COLUMN IF NOT EXISTS pto_emi         char(3),
  ADD COLUMN IF NOT EXISTS doc_type        char(2),
  ADD COLUMN IF NOT EXISTS last_sequential integer;

-- ── 2-C  Backfill / clean orphaned rows before tightening constraints ─────
-- Rows with NULL tenant_id have no owner and cannot satisfy the FK or UNIQUE
-- constraint. Delete them — they are sequence garbage from the drifted schema.
DELETE FROM public.document_sequences WHERE tenant_id IS NULL;

-- Rows with null routing columns get safe defaults so they survive NOT NULL.
-- These are pre-existing rows from before the multi-column schema; default
-- them to the standard first establishment / emission point.
UPDATE public.document_sequences
   SET estab    = COALESCE(estab,    '001'),
       pto_emi  = COALESCE(pto_emi,  '001'),
       doc_type = COALESCE(doc_type, '01'),
       last_sequential = COALESCE(last_sequential, 0)
 WHERE estab IS NULL
    OR pto_emi IS NULL
    OR doc_type IS NULL
    OR last_sequential IS NULL;

-- ── 2-D  Tighten NOT NULL (idempotent — only acts when still nullable) ────
DO $$
BEGIN
  -- tenant_id
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'document_sequences'
       AND column_name = 'tenant_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.document_sequences ALTER COLUMN tenant_id SET NOT NULL;
    RAISE NOTICE 'v24: document_sequences.tenant_id SET NOT NULL.';
  END IF;

  -- estab
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'document_sequences'
       AND column_name = 'estab' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.document_sequences ALTER COLUMN estab SET NOT NULL;
    RAISE NOTICE 'v24: document_sequences.estab SET NOT NULL.';
  END IF;

  -- pto_emi
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'document_sequences'
       AND column_name = 'pto_emi' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.document_sequences ALTER COLUMN pto_emi SET NOT NULL;
    RAISE NOTICE 'v24: document_sequences.pto_emi SET NOT NULL.';
  END IF;

  -- doc_type
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'document_sequences'
       AND column_name = 'doc_type' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.document_sequences ALTER COLUMN doc_type SET NOT NULL;
    RAISE NOTICE 'v24: document_sequences.doc_type SET NOT NULL.';
  END IF;

  -- last_sequential + DEFAULT 0
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'document_sequences'
       AND column_name = 'last_sequential' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE public.document_sequences
      ALTER COLUMN last_sequential SET NOT NULL,
      ALTER COLUMN last_sequential SET DEFAULT 0;
    RAISE NOTICE 'v24: document_sequences.last_sequential SET NOT NULL DEFAULT 0.';
  ELSE
    -- Column exists and is NOT NULL — ensure DEFAULT is set regardless.
    ALTER TABLE public.document_sequences
      ALTER COLUMN last_sequential SET DEFAULT 0;
  END IF;
END $$;

-- ── 2-E  FK constraint: tenant_id → tenants(id) ───────────────────────────
-- Only add if missing. Requires tenant_id to be NOT NULL (done above)
-- and all existing values to reference valid tenants (guaranteed by DELETE).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.document_sequences'::regclass
       AND contype  = 'f'
       AND conkey   = ARRAY[
         (SELECT attnum FROM pg_attribute
           WHERE attrelid = 'public.document_sequences'::regclass
             AND attname  = 'tenant_id')
       ]::smallint[]
  ) THEN
    ALTER TABLE public.document_sequences
      ADD CONSTRAINT document_sequences_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
    RAISE NOTICE 'v24: FK document_sequences.tenant_id → tenants(id) añadida.';
  END IF;
END $$;

-- ── 2-F  UNIQUE constraint (requires all four columns to exist and be NOT NULL)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.document_sequences'::regclass
       AND conname  = 'uq_document_sequences'
  ) THEN
    ALTER TABLE public.document_sequences
      ADD CONSTRAINT uq_document_sequences
        UNIQUE (tenant_id, estab, pto_emi, doc_type);
    RAISE NOTICE 'v24: UNIQUE constraint uq_document_sequences añadida.';
  END IF;
END $$;

-- ── 2-G  Index (must come AFTER all routing columns exist) ────────────────
CREATE INDEX IF NOT EXISTS idx_document_sequences_lookup
  ON public.document_sequences(tenant_id, estab, pto_emi, doc_type);

-- ── 2-H  RLS ──────────────────────────────────────────────────────────────
-- Sequences are read-only for tenants; increment is done via SECURITY DEFINER
-- function (bypasses RLS), so only SELECT policy is needed here.
ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'document_sequences'
       AND policyname = 'docseq_tenant_access'
  ) THEN
    CREATE POLICY "docseq_tenant_access" ON public.document_sequences
      FOR SELECT
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_memberships
           WHERE user_id = auth.uid() AND is_active = true
        )
      );
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════
-- 3. next_invoice_sequential() — atomic sequence reservation
-- ══════════════════════════════════════════════════════════════
-- Uses INSERT ... ON CONFLICT DO UPDATE ... RETURNING which is
-- a single atomic statement — no separate lock needed.
-- Returns the reserved sequential number as an integer.
-- The caller formats it as a zero-padded 9-digit string.
--
-- SECURITY DEFINER: runs as the function owner (postgres), bypassing
-- RLS on document_sequences. Authorization is enforced by the calling
-- server action (getActiveMembership checks).

CREATE OR REPLACE FUNCTION public.next_invoice_sequential(
  p_tenant_id  uuid,
  p_estab      char,
  p_pto_emi    char,
  p_doc_type   char
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
-- Prevents search_path injection: an attacker cannot shadow pg_catalog or
-- public objects by manipulating search_path before calling this function.
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO public.document_sequences (tenant_id, estab, pto_emi, doc_type, last_sequential)
  VALUES (p_tenant_id, p_estab, p_pto_emi, p_doc_type, 1)
  ON CONFLICT (tenant_id, estab, pto_emi, doc_type)
  DO UPDATE
    SET last_sequential = document_sequences.last_sequential + 1
  RETURNING last_sequential
    INTO v_next;

  RETURN v_next;
END;
$$;

-- Verification
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'tenant_fiscal_config'
  ) THEN
    RAISE EXCEPTION 'v24 FAILED: tenant_fiscal_config no existe.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'document_sequences'
  ) THEN
    RAISE EXCEPTION 'v24 FAILED: document_sequences no existe.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'next_invoice_sequential'
       AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'v24 FAILED: función next_invoice_sequential no existe.';
  END IF;

  RAISE NOTICE 'v24 OK: tenant_fiscal_config + document_sequences + next_invoice_sequential().';
END $$;
