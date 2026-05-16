-- ============================================================
-- v23_exchange_credit_audit.sql
--
-- Adds two audit columns to sale_returns to track exactly how
-- refund_amount was consumed in an exchange (cambio):
--
--   exchange_credit_applied:
--     Amount of refund_amount applied as credit toward the new
--     (replacement) sale. Max = min(refund_amount, new_sale.total).
--
--   exchange_credit_refunded:
--     Amount of refund_amount returned to the client in cash
--     because the new sale total was less than the refund.
--     When > 0 AND a cash session is open, a cash_out movement
--     is created to keep the caja ledger consistent.
--
--   Implicit residual (not a column — computed at query time):
--     exchange_credit_cedido = refund_amount
--                              - exchange_credit_applied
--                              - exchange_credit_refunded
--     Represents credit the client forfeited ("cedió") when the
--     cashier chose "Sin reembolso". Shown explicitly in UI.
--
-- DB constraints added:
--   1. exchange_credit_applied  >= 0
--   2. exchange_credit_refunded >= 0
--   3. exchange_credit_applied + exchange_credit_refunded <= refund_amount
--
-- Safety analysis for constraint 3:
--   • Existing rows: both columns default to 0, so 0+0=0 ≤ refund_amount
--     (always true, or NULL-result if refund_amount IS NULL, which
--      PostgreSQL treats as NOT violated — no row will fail the scan).
--   • Future rows: linkExchangeSaleAction ensures
--       applied  = min(refund_amount, new_sale.total)
--       refunded = max(0, refund_amount - new_sale.total)
--     ∴ applied + refunded = min(refund_amount, ...) + max(0, ...)
--       which can never exceed refund_amount by construction.
--
-- Idempotency:
--   ADD COLUMN IF NOT EXISTS  — no-op when column exists.
--   ADD CONSTRAINT guarded by DO blocks checking pg_constraint.
--   All paths safe to re-run.
-- ============================================================


-- ── 1. Add columns ────────────────────────────────────────────────────────────
-- NOT NULL DEFAULT 0: safe to add to a table with existing rows because
-- PostgreSQL fills existing rows with the default immediately.

ALTER TABLE public.sale_returns
  ADD COLUMN IF NOT EXISTS exchange_credit_applied  numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_credit_refunded numeric(12,2) NOT NULL DEFAULT 0;


-- ── 2. Constraint: exchange_credit_applied >= 0 ───────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sale_returns'::regclass
       AND conname  = 'sale_returns_exc_applied_nonneg'
  ) THEN
    ALTER TABLE public.sale_returns
      ADD CONSTRAINT sale_returns_exc_applied_nonneg
        CHECK (exchange_credit_applied >= 0);
    RAISE NOTICE 'v23: constraint sale_returns_exc_applied_nonneg añadida.';
  ELSE
    RAISE NOTICE 'v23: constraint sale_returns_exc_applied_nonneg ya existía — sin cambio.';
  END IF;
END $$;


-- ── 3. Constraint: exchange_credit_refunded >= 0 ──────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sale_returns'::regclass
       AND conname  = 'sale_returns_exc_refunded_nonneg'
  ) THEN
    ALTER TABLE public.sale_returns
      ADD CONSTRAINT sale_returns_exc_refunded_nonneg
        CHECK (exchange_credit_refunded >= 0);
    RAISE NOTICE 'v23: constraint sale_returns_exc_refunded_nonneg añadida.';
  ELSE
    RAISE NOTICE 'v23: constraint sale_returns_exc_refunded_nonneg ya existía — sin cambio.';
  END IF;
END $$;


-- ── 4. Constraint: applied + refunded <= refund_amount ────────────────────────
-- Guards against double-disbursement bugs. Safe because:
--   • Existing rows: 0 + 0 = 0 ≤ refund_amount (true or NULL — both pass).
--   • Future rows: enforced structurally by linkExchangeSaleAction (see header).
-- The constraint is NULL-permissive: if refund_amount IS NULL the expression
-- evaluates to NULL and PostgreSQL does NOT treat that as a violation.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sale_returns'::regclass
       AND conname  = 'sale_returns_exc_credit_sum_check'
  ) THEN
    ALTER TABLE public.sale_returns
      ADD CONSTRAINT sale_returns_exc_credit_sum_check
        CHECK (exchange_credit_applied + exchange_credit_refunded <= refund_amount);
    RAISE NOTICE 'v23: constraint sale_returns_exc_credit_sum_check añadida.';
  ELSE
    RAISE NOTICE 'v23: constraint sale_returns_exc_credit_sum_check ya existía — sin cambio.';
  END IF;
END $$;


-- ── 5. Verification ───────────────────────────────────────────────────────────

DO $$
DECLARE
  v_col_applied  boolean;
  v_col_refunded boolean;
  v_con_nonneg_a boolean;
  v_con_nonneg_r boolean;
  v_con_sum      boolean;
  v_bad_rows     integer;
BEGIN
  -- Columns exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sale_returns'
       AND column_name = 'exchange_credit_applied'
  ) INTO v_col_applied;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sale_returns'
       AND column_name = 'exchange_credit_refunded'
  ) INTO v_col_refunded;

  -- Constraints exist
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sale_returns'::regclass
       AND conname  = 'sale_returns_exc_applied_nonneg'
  ) INTO v_con_nonneg_a;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sale_returns'::regclass
       AND conname  = 'sale_returns_exc_refunded_nonneg'
  ) INTO v_con_nonneg_r;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.sale_returns'::regclass
       AND conname  = 'sale_returns_exc_credit_sum_check'
  ) INTO v_con_sum;

  -- No rows violate the sum invariant (catches data issues on re-run)
  SELECT COUNT(*) INTO v_bad_rows
    FROM public.sale_returns
   WHERE exchange_credit_applied + exchange_credit_refunded > refund_amount;

  IF NOT v_col_applied  THEN RAISE EXCEPTION 'v23 FAILED: columna exchange_credit_applied no existe.'; END IF;
  IF NOT v_col_refunded THEN RAISE EXCEPTION 'v23 FAILED: columna exchange_credit_refunded no existe.'; END IF;
  IF NOT v_con_nonneg_a THEN RAISE EXCEPTION 'v23 FAILED: constraint exc_applied_nonneg no existe.'; END IF;
  IF NOT v_con_nonneg_r THEN RAISE EXCEPTION 'v23 FAILED: constraint exc_refunded_nonneg no existe.'; END IF;
  IF NOT v_con_sum      THEN RAISE EXCEPTION 'v23 FAILED: constraint exc_credit_sum_check no existe.'; END IF;
  IF v_bad_rows > 0     THEN RAISE EXCEPTION 'v23 FAILED: % filas violan el invariante applied+refunded<=refund_amount.', v_bad_rows; END IF;

  RAISE NOTICE
    'v23 OK: 2 columnas + 3 constraints en sale_returns. % filas existentes verificadas sin violaciones.',
    (SELECT COUNT(*) FROM public.sale_returns);
END $$;
