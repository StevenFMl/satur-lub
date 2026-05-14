-- ============================================================
-- v11_receivable_followups.sql
--
-- Adds follow-up / cobranza tracking to customer_receivables:
--
--   · 3 denormalized columns on customer_receivables
--     (last_followup_at, last_followup_result, next_followup_date)
--   · receivable_followups table — contact history audit trail
--   · add_receivable_followup() RPC
--   · Recreates v_customer_receivables view with new columns
--
-- Idempotent strategy (same as v9/v10):
--   ADD COLUMN IF NOT EXISTS · CREATE TABLE IF NOT EXISTS
--   DO $$ guard for constraints + policies
--   CREATE OR REPLACE FUNCTION · DROP + CREATE for view
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. Schema patch — customer_receivables (denormalized cache)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.customer_receivables
  ADD COLUMN IF NOT EXISTS last_followup_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_followup_result text,
  ADD COLUMN IF NOT EXISTS next_followup_date   date;

-- CHECK constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.customer_receivables'::regclass
       AND contype  = 'c'
       AND conname  = 'cr_last_followup_result_check'
  ) THEN
    ALTER TABLE public.customer_receivables
      ADD CONSTRAINT cr_last_followup_result_check
        CHECK (last_followup_result IN ('no_contact','no_answer','called','promised_pay'));
  END IF;
END $$;

-- Sparse index for "needs follow-up today/soon" queries
CREATE INDEX IF NOT EXISTS idx_receivables_next_followup
  ON public.customer_receivables(tenant_id, next_followup_date)
  WHERE status NOT IN ('paid','cancelled');


-- ══════════════════════════════════════════════════════════════
-- 2. receivable_followups — contact history
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.receivable_followups (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid         NOT NULL REFERENCES public.tenants(id)              ON DELETE CASCADE,
  receivable_id  uuid         NOT NULL REFERENCES public.customer_receivables(id) ON DELETE RESTRICT,
  result         text         NOT NULL
                   CHECK (result IN ('no_contact','no_answer','called','promised_pay')),
  note           text,
  next_followup  date,
  performed_by   uuid         NOT NULL,
  created_at     timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_followups_receivable
  ON public.receivable_followups(tenant_id, receivable_id);

ALTER TABLE public.receivable_followups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'receivable_followups'
       AND policyname = 'followups_tenant_access'
  ) THEN
    CREATE POLICY "followups_tenant_access" ON public.receivable_followups
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
-- 3. Recreate v_customer_receivables (adds followup columns)
-- ══════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.v_customer_receivables;

CREATE VIEW public.v_customer_receivables
WITH (security_invoker = true)
AS
SELECT
  cr.id,
  cr.tenant_id,
  cr.sale_id,
  cr.customer_id,
  bp.full_name        AS customer_name,
  bp.document_number  AS customer_document,
  bp.phone            AS customer_phone,
  s.sale_date,
  s.document_kind,
  cr.total_amount,
  cr.paid_amount,
  cr.balance_due,
  cr.status,
  cr.due_date,
  CASE
    WHEN cr.due_date IS NOT NULL
     AND cr.due_date < CURRENT_DATE
     AND cr.status NOT IN ('paid','cancelled')
    THEN true
    ELSE false
  END                      AS is_overdue,
  cr.notes,
  cr.created_by,
  cr.created_at,
  cr.updated_at,
  cr.last_followup_at,
  cr.last_followup_result,
  cr.next_followup_date
FROM public.customer_receivables cr
JOIN public.sales s
  ON s.id = cr.sale_id
JOIN public.business_partners bp
  ON bp.id = cr.customer_id
 AND bp.tenant_id = cr.tenant_id;

GRANT SELECT ON public.v_customer_receivables TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 4. RPC add_receivable_followup
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.add_receivable_followup(
  p_tenant_id      uuid,
  p_receivable_id  uuid,
  p_result         text,
  p_note           text  DEFAULT NULL,
  p_next_followup  date  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_followup_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;

  IF p_result NOT IN ('no_contact','no_answer','called','promised_pay') THEN
    RAISE EXCEPTION 'Resultado de gestión inválido: %', p_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.customer_receivables
     WHERE id = p_receivable_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Cuenta por cobrar no encontrada';
  END IF;

  -- Insert follow-up record
  INSERT INTO public.receivable_followups (
    tenant_id, receivable_id, result, note, next_followup, performed_by
  ) VALUES (
    p_tenant_id, p_receivable_id, p_result, p_note, p_next_followup, v_user_id
  ) RETURNING id INTO v_followup_id;

  -- Denormalize onto parent row for fast view queries
  UPDATE public.customer_receivables
     SET last_followup_at     = now(),
         last_followup_result = p_result,
         next_followup_date   = p_next_followup,
         updated_at           = now()
   WHERE id = p_receivable_id AND tenant_id = p_tenant_id;

  RETURN v_followup_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_receivable_followup(uuid, uuid, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_receivable_followup(uuid, uuid, text, text, date) TO authenticated;
