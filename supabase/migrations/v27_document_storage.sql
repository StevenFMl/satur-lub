-- ============================================================
-- v27_document_storage.sql
--
-- Supabase Storage infrastructure for fiscal documents.
--
-- Creates:
--   1. Private bucket  "documentos-fiscales"
--   2. Storage path columns on electronic_invoices
--   3. Tenant-scoped RLS policies on storage.objects
--
-- Path convention (all under one private bucket):
--   {tenant_id}/{estab}-{pto_emi}/invoices/{yyyy}/{mm}/{access_key}.xml
--   {tenant_id}/{estab}-{pto_emi}/rides/{yyyy}/{mm}/{access_key}.pdf
--   {tenant_id}/{estab}-{pto_emi}/prints/{yyyy}/{mm}/VENTA-{sale_id}.pdf
--
-- Security model:
--   - Server-side uploads use createAdminClient() (service_role key) →
--     RLS is bypassed. Permission is already checked at the action layer.
--   - User JWT client is checked by the policies below for:
--     · Direct reads (rare — normally use signed URLs)
--     · Signed URL generation when called with user JWT
--   - The first path segment is always tenant_id (UUID), which is used
--     by policies to enforce per-tenant access.
--
-- Idempotency:
--   ON CONFLICT / ADD COLUMN IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================

-- ── 1. Private bucket ──────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documentos-fiscales',
  'documentos-fiscales',
  false,          -- private
  10485760,       -- 10 MB per file (XML ≈ 50 KB, PDF ≈ 200 KB; limit is defensive)
  ARRAY[
    'application/xml',
    'application/pdf',
    'text/xml',
    'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET
    public             = false,
    file_size_limit    = 10485760,
    allowed_mime_types = ARRAY[
      'application/xml',
      'application/pdf',
      'text/xml',
      'text/plain'
    ];

-- ── 2. Storage path columns on electronic_invoices ────────────────────────

ALTER TABLE public.electronic_invoices
  ADD COLUMN IF NOT EXISTS xml_storage_path text;

ALTER TABLE public.electronic_invoices
  ADD COLUMN IF NOT EXISTS pdf_storage_path text;

COMMENT ON COLUMN public.electronic_invoices.xml_storage_path IS
  'Storage object path (documentos-fiscales bucket): {tenant_id}/{branch}/invoices/{yyyy}/{mm}/{access_key}.xml';
COMMENT ON COLUMN public.electronic_invoices.pdf_storage_path IS
  'Storage object path (documentos-fiscales bucket): {tenant_id}/{branch}/rides/{yyyy}/{mm}/{access_key}.pdf';

-- ── 3. RLS policies on storage.objects ────────────────────────────────────
-- Tenant isolation: (string_to_array(name, '/'))[1] is the tenant_id string
-- from the object path. We compare it against the tenant_ids the
-- authenticated user belongs to.
--
-- The subquery is safe against injection — string_to_array returns text,
-- tenant_id::text is always a valid UUID string from our table.
--
-- service_role bypasses RLS entirely, so uploads from server actions
-- are unaffected by these policies.

-- Drop existing policies (idempotent recreate)
DROP POLICY IF EXISTS "fiscal_docs_select" ON storage.objects;
DROP POLICY IF EXISTS "fiscal_docs_insert" ON storage.objects;
DROP POLICY IF EXISTS "fiscal_docs_update" ON storage.objects;
DROP POLICY IF EXISTS "fiscal_docs_delete" ON storage.objects;

-- SELECT: authenticated users can read documents of their own tenants
CREATE POLICY "fiscal_docs_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'documentos-fiscales'
  AND (string_to_array(storage.objects.name, '/'))[1] IN (
    SELECT tm.tenant_id::text
    FROM   public.tenant_memberships tm
    WHERE  tm.user_id   = auth.uid()
      AND  tm.is_active = true
  )
);

-- INSERT: members can upload (service_role bypasses; this is a safety net
--         for direct client-side uploads if ever enabled)
CREATE POLICY "fiscal_docs_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documentos-fiscales'
  AND (string_to_array(storage.objects.name, '/'))[1] IN (
    SELECT tm.tenant_id::text
    FROM   public.tenant_memberships tm
    WHERE  tm.user_id   = auth.uid()
      AND  tm.is_active = true
  )
);

-- UPDATE: members can overwrite (needed for upsert/retry behavior)
CREATE POLICY "fiscal_docs_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documentos-fiscales'
  AND (string_to_array(storage.objects.name, '/'))[1] IN (
    SELECT tm.tenant_id::text
    FROM   public.tenant_memberships tm
    WHERE  tm.user_id   = auth.uid()
      AND  tm.is_active = true
  )
);

-- DELETE: owners only (administrative removal of documents)
CREATE POLICY "fiscal_docs_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'documentos-fiscales'
  AND (string_to_array(storage.objects.name, '/'))[1] IN (
    SELECT tm.tenant_id::text
    FROM   public.tenant_memberships tm
    WHERE  tm.user_id   = auth.uid()
      AND  tm.is_active = true
      AND  tm.role = 'owner'
  )
);

-- ── 4. Verification ────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'documentos-fiscales'
  ) THEN
    RAISE EXCEPTION 'v27 FAILED: bucket documentos-fiscales was not created.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'electronic_invoices'
      AND  column_name  = 'xml_storage_path'
  ) THEN
    RAISE EXCEPTION 'v27 FAILED: xml_storage_path column not found on electronic_invoices.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'electronic_invoices'
      AND  column_name  = 'pdf_storage_path'
  ) THEN
    RAISE EXCEPTION 'v27 FAILED: pdf_storage_path column not found on electronic_invoices.';
  END IF;

  RAISE NOTICE 'v27 OK: documentos-fiscales bucket + storage path columns + RLS policies applied.';
END $$;
