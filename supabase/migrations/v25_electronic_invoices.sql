-- ============================================================
-- v25_electronic_invoices.sql
--
-- Stores every comprobante electrónico generated for sales.
--
-- One row per comprobante. A single sale has at most ONE factura
-- (doc_type = '01'). Future nota de crédito (doc_type = '04')
-- per return will share this table via sale_return_id.
--
-- Lifecycle / status:
--   draft       → XML generated, not yet sent to SRI
--   sent        → Submitted to SRI SOAP endpoint, awaiting response
--   authorized  → SRI returned authorization number + date
--   rejected    → SRI rejected the XML (errors stored in sri_errors)
--   cancelled   → Operator cancelled/annulled the comprobante
--
-- XML storage policy:
--   xml_unsigned stores the pre-signature XML (never null once draft).
--   xml_signed   stores the XAdES-BES signed XML (null until signed).
--   These can be large (~4-8 KB). For very high volume, move to object
--   storage and store only the URL here.
--
-- The actual digital certificate (.p12) is NEVER stored in the DB.
-- It lives in an environment variable or secrets manager.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.electronic_invoices (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Links to source documents
  sale_id               uuid          REFERENCES public.sales(id) ON DELETE RESTRICT,
  -- sale_return_id for notas de crédito (future)
  sale_return_id        uuid          REFERENCES public.sale_returns(id) ON DELETE RESTRICT,

  -- SRI document numbering
  doc_type              char(2)       NOT NULL DEFAULT '01',
                                      -- '01'=factura, '04'=nc, '05'=nd, '07'=ret
  estab                 char(3)       NOT NULL,
  pto_emi               char(3)       NOT NULL,
  secuencial            integer       NOT NULL,  -- raw integer, formatted as 000000001 in XML
  -- Full formatted document number: estab-pto_emi-secuencial (e.g. "001-001-000000001")
  doc_number            text          GENERATED ALWAYS AS (
                            estab || '-' || pto_emi || '-' || lpad(secuencial::text, 9, '0')
                          ) STORED,

  -- SRI access key (49 digits, computed once, immutable)
  access_key            char(49)      UNIQUE,

  -- SRI environment at time of emission
  sri_environment       text          NOT NULL DEFAULT 'pruebas'
                          CHECK (sri_environment IN ('pruebas', 'produccion')),

  -- Document lifecycle
  status                text          NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','sent','authorized','rejected','cancelled')),

  -- XML content
  xml_unsigned          text,         -- raw XML before signature
  xml_signed            text,         -- XAdES-BES signed XML (null until signed)

  -- SRI authorization response
  authorization_number  text,         -- número de autorización SRI (37 digits)
  authorization_date    timestamptz,  -- fecha/hora de autorización SRI
  sri_errors            jsonb,        -- array of SRI error objects when rejected

  -- Cancellation
  cancelled_at          timestamptz,
  cancellation_reason   text,

  -- Audit
  created_by            uuid          NOT NULL,  -- user who triggered generation
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),

  -- Prevent duplicate invoice for same sale+doc_type
  CONSTRAINT uq_electronic_invoices_sale_doctype
    UNIQUE (sale_id, doc_type),

  -- Either sale_id or sale_return_id must be set (not both null)
  CONSTRAINT chk_electronic_invoices_source
    CHECK (sale_id IS NOT NULL OR sale_return_id IS NOT NULL)
);

-- Patch path — simple nullable columns (safe ADD COLUMN IF NOT EXISTS)
ALTER TABLE public.electronic_invoices
  ADD COLUMN IF NOT EXISTS sale_return_id       uuid  REFERENCES public.sale_returns(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS xml_unsigned         text,
  ADD COLUMN IF NOT EXISTS xml_signed           text,
  ADD COLUMN IF NOT EXISTS authorization_number text,
  ADD COLUMN IF NOT EXISTS authorization_date   timestamptz,
  ADD COLUMN IF NOT EXISTS sri_errors           jsonb,
  ADD COLUMN IF NOT EXISTS cancelled_at         timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason  text,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now();

-- Patch path — doc_number: must always be GENERATED ALWAYS AS (...) STORED.
--
-- Three scenarios handled:
--   A) Column does not exist yet → ADD as GENERATED (fresh patch install).
--   B) Column exists as a STORED generated column → no-op (already correct).
--   C) Column exists as plain text (e.g. from ADD COLUMN IF NOT EXISTS text
--      in a previous incorrect migration) → DROP and re-ADD as GENERATED.
--      This is safe because doc_number is always computable from
--      estab + pto_emi + secuencial; it contains no independent data.
--
-- Detection: pg_attribute.attgenerated = 's' means STORED generated.
--   attgenerated = '' or NULL means plain column (not generated).

DO $$
DECLARE
  v_attgenerated text;
BEGIN
  SELECT attgenerated::text
    INTO v_attgenerated
    FROM pg_attribute
   WHERE attrelid  = 'public.electronic_invoices'::regclass
     AND attname   = 'doc_number'
     AND attnum    > 0
     AND NOT attisdropped;

  IF v_attgenerated IS NULL THEN
    -- Scenario A: column absent — add as GENERATED ALWAYS AS STORED.
    ALTER TABLE public.electronic_invoices
      ADD COLUMN doc_number text GENERATED ALWAYS AS (
        estab || '-' || pto_emi || '-' || lpad(secuencial::text, 9, '0')
      ) STORED;
    RAISE NOTICE 'v25: doc_number created as GENERATED ALWAYS AS STORED.';

  ELSIF v_attgenerated = 's' THEN
    -- Scenario B: already a stored generated column — nothing to do.
    RAISE NOTICE 'v25: doc_number is already GENERATED ALWAYS AS STORED — no change.';

  ELSE
    -- Scenario C: exists as plain text (wrong) — drop and recreate.
    -- All values are recomputable; no data is lost.
    ALTER TABLE public.electronic_invoices DROP COLUMN doc_number;
    ALTER TABLE public.electronic_invoices
      ADD COLUMN doc_number text GENERATED ALWAYS AS (
        estab || '-' || pto_emi || '-' || lpad(secuencial::text, 9, '0')
      ) STORED;
    RAISE NOTICE 'v25: doc_number was plain text — dropped and recreated as GENERATED ALWAYS AS STORED.';
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_einvoices_tenant_sale
  ON public.electronic_invoices(tenant_id, sale_id);

CREATE INDEX IF NOT EXISTS idx_einvoices_tenant_status
  ON public.electronic_invoices(tenant_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_einvoices_access_key
  ON public.electronic_invoices(access_key)
  WHERE access_key IS NOT NULL;

-- RLS
ALTER TABLE public.electronic_invoices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'electronic_invoices'
       AND policyname = 'einvoices_tenant_access'
  ) THEN
    CREATE POLICY "einvoices_tenant_access" ON public.electronic_invoices
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

-- Verification
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'electronic_invoices'
  ) THEN
    RAISE EXCEPTION 'v25 FAILED: electronic_invoices no existe.';
  END IF;

  RAISE NOTICE 'v25 OK: electronic_invoices lista con RLS y constraints.';
END $$;
