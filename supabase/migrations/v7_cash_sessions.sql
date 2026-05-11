-- ============================================================
-- v7_cash_sessions.sql
--
-- Formal cash drawer / session management for the POS.
--
-- Design decisions:
--   Session scope: per (tenant_id, warehouse_id).
--     One open session per warehouse — if warehouse_id IS NULL,
--     one open session per tenant.  Enforced by partial unique indexes.
--
--   Ledger approach: cash_movements is the single source of truth.
--     expected_cash = opening_amount + SUM(direction * amount).
--     No scattered queries to sales/returns for the balance.
--
--   Integration: create_sale, void_sale, create_sale_return all receive
--     an optional p_cash_session_id.  When provided, an atomic
--     cash_movement is recorded in the same transaction.
--
--   Permissions: only owner/admin can open, close, or add manual
--     movements (paid_in/paid_out).  Sale cash entries are automatic.
--
-- Idempotency strategy:
--   Each table section has two paths:
--     A) CREATE TABLE IF NOT EXISTS  — runs in full on a clean database.
--     B) ALTER TABLE ADD COLUMN IF NOT EXISTS — patches a table that
--        already exists from a prior (possibly partial/failed) run,
--        ensuring every column is present before indexes, constraints,
--        and policies are applied.  ADD COLUMN IF NOT EXISTS is a no-op
--        when the column already exists, so existing data is untouched.
--   CHECK constraints are guarded by DO blocks that query pg_constraint
--   before issuing ALTER TABLE ADD CONSTRAINT, preventing duplicate errors.
--   All indexes use CREATE INDEX/UNIQUE INDEX IF NOT EXISTS.
--   All policies use a DO block that checks pg_policies first.
--   All RPCs use CREATE OR REPLACE FUNCTION — inherently idempotent.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. cash_sessions
-- ══════════════════════════════════════════════════════════════

-- ── 1-A  Fresh-install path ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL REFERENCES public.tenants(id)    ON DELETE CASCADE,
  warehouse_id   uuid          REFERENCES public.warehouses(id)          ON DELETE SET NULL,
  status         text          NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'closed')),
  opened_by      uuid          NOT NULL,
  opened_at      timestamptz   NOT NULL DEFAULT now(),
  opening_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  closed_by      uuid,
  closed_at      timestamptz,
  counted_cash   numeric(12,2) CHECK (counted_cash  >= 0),
  expected_cash  numeric(12,2),
  variance       numeric(12,2),
  notes          text
);

-- ── 1-B  Patch path: ensure every column exists ───────────────
-- Columns with a DEFAULT are safe to add to tables that already have
-- rows — PostgreSQL fills existing rows with the default value.
ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS warehouse_id   uuid          REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status         text          NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS opened_at      timestamptz   NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS opening_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closed_by      uuid,
  ADD COLUMN IF NOT EXISTS closed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS counted_cash   numeric(12,2),
  ADD COLUMN IF NOT EXISTS expected_cash  numeric(12,2),
  ADD COLUMN IF NOT EXISTS variance       numeric(12,2),
  ADD COLUMN IF NOT EXISTS notes          text;

-- opened_by has no universally safe DEFAULT so it is added as nullable,
-- any NULLs are backfilled with a sentinel UUID, then NOT NULL is applied
-- only when the column is still nullable (i.e. it was just added).
ALTER TABLE public.cash_sessions
  ADD COLUMN IF NOT EXISTS opened_by uuid;

DO $$
BEGIN
  UPDATE public.cash_sessions
     SET opened_by = '00000000-0000-0000-0000-000000000000'::uuid
   WHERE opened_by IS NULL;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'cash_sessions'
       AND column_name  = 'opened_by'
       AND is_nullable  = 'YES'
  ) THEN
    ALTER TABLE public.cash_sessions ALTER COLUMN opened_by SET NOT NULL;
  END IF;
END $$;

-- ── 1-C  CHECK constraints ────────────────────────────────────
-- Checked by the auto-generated name PostgreSQL assigns to inline
-- column constraints (pattern: {table}_{column}_check).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cash_sessions'::regclass
       AND conname  = 'cash_sessions_status_check'
  ) THEN
    ALTER TABLE public.cash_sessions
      ADD CONSTRAINT cash_sessions_status_check
        CHECK (status IN ('open', 'closed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cash_sessions'::regclass
       AND conname  = 'cash_sessions_opening_amount_check'
  ) THEN
    ALTER TABLE public.cash_sessions
      ADD CONSTRAINT cash_sessions_opening_amount_check
        CHECK (opening_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cash_sessions'::regclass
       AND conname  = 'cash_sessions_counted_cash_check'
  ) THEN
    ALTER TABLE public.cash_sessions
      ADD CONSTRAINT cash_sessions_counted_cash_check
        CHECK (counted_cash >= 0);
  END IF;
END $$;

-- ── 1-D  Indexes ──────────────────────────────────────────────
-- warehouse_id is guaranteed to exist at this point.

-- One open session per tenant+warehouse
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_sessions_open_wh
  ON public.cash_sessions(tenant_id, warehouse_id)
  WHERE status = 'open' AND warehouse_id IS NOT NULL;

-- One open session per tenant (when not using warehouses)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_sessions_open_no_wh
  ON public.cash_sessions(tenant_id)
  WHERE status = 'open' AND warehouse_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_status
  ON public.cash_sessions(tenant_id, status);

-- ── 1-E  RLS ──────────────────────────────────────────────────
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'cash_sessions'
       AND policyname = 'cash_sessions_tenant_access'
  ) THEN
    CREATE POLICY "cash_sessions_tenant_access" ON public.cash_sessions
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
-- 2. cash_movements
-- ══════════════════════════════════════════════════════════════

-- ── 2-A  Fresh-install path ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES public.tenants(id)       ON DELETE CASCADE,
  cash_session_id uuid          NOT NULL REFERENCES public.cash_sessions(id) ON DELETE RESTRICT,
  movement_type   text          NOT NULL
                    CHECK (movement_type IN ('cash_in', 'cash_out', 'paid_in', 'paid_out')),
  direction       integer       NOT NULL CHECK (direction IN (1, -1)),
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  reason          text          NOT NULL,
  reference_type  text,
  reference_id    uuid,
  created_by      uuid          NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT chk_cash_movement_direction CHECK (
    (movement_type IN ('cash_in',  'paid_in')  AND direction =  1) OR
    (movement_type IN ('cash_out', 'paid_out') AND direction = -1)
  )
);

-- ── 2-B  Patch path: ensure every column exists ───────────────
-- Nullable columns — safe at any time.
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS reference_type  text,
  ADD COLUMN IF NOT EXISTS reference_id    uuid,
  ADD COLUMN IF NOT EXISTS created_at      timestamptz NOT NULL DEFAULT now();

-- NOT NULL columns without a safe universal DEFAULT are added nullable
-- first, backfilled with sentinels, then tightened via DO block.
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS movement_type  text,
  ADD COLUMN IF NOT EXISTS direction      integer,
  ADD COLUMN IF NOT EXISTS amount         numeric(12,2),
  ADD COLUMN IF NOT EXISTS reason         text,
  ADD COLUMN IF NOT EXISTS created_by     uuid;

-- Backfill any NULLs that appeared via the nullable-add path above.
-- These sentinels are only written to rows whose columns did not exist
-- before this migration (the tables are new; in practice there are none).
UPDATE public.cash_movements SET movement_type = 'cash_in'                                   WHERE movement_type IS NULL;
UPDATE public.cash_movements SET direction     = 1                                            WHERE direction     IS NULL;
UPDATE public.cash_movements SET amount        = 0.01                                         WHERE amount        IS NULL;
UPDATE public.cash_movements SET reason        = '(migración)'                                WHERE reason        IS NULL;
UPDATE public.cash_movements SET created_by    = '00000000-0000-0000-0000-000000000000'::uuid WHERE created_by    IS NULL;

-- Apply NOT NULL to each column that is still nullable after the backfill.
DO $$
DECLARE
  v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['movement_type','direction','amount','reason','created_by']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'cash_movements'
         AND column_name  = v_col
         AND is_nullable  = 'YES'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.cash_movements ALTER COLUMN %I SET NOT NULL', v_col
      );
    END IF;
  END LOOP;
END $$;

-- ── 2-C  CHECK constraints ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cash_movements'::regclass
       AND conname  = 'cash_movements_movement_type_check'
  ) THEN
    ALTER TABLE public.cash_movements
      ADD CONSTRAINT cash_movements_movement_type_check
        CHECK (movement_type IN ('cash_in', 'cash_out', 'paid_in', 'paid_out'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cash_movements'::regclass
       AND conname  = 'cash_movements_direction_check'
  ) THEN
    ALTER TABLE public.cash_movements
      ADD CONSTRAINT cash_movements_direction_check
        CHECK (direction IN (1, -1));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cash_movements'::regclass
       AND conname  = 'cash_movements_amount_check'
  ) THEN
    ALTER TABLE public.cash_movements
      ADD CONSTRAINT cash_movements_amount_check
        CHECK (amount > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cash_movements'::regclass
       AND conname  = 'chk_cash_movement_direction'
  ) THEN
    ALTER TABLE public.cash_movements
      ADD CONSTRAINT chk_cash_movement_direction CHECK (
        (movement_type IN ('cash_in',  'paid_in')  AND direction =  1) OR
        (movement_type IN ('cash_out', 'paid_out') AND direction = -1)
      );
  END IF;
END $$;

-- ── 2-D  Indexes ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cash_movements_session
  ON public.cash_movements(tenant_id, cash_session_id);

CREATE INDEX IF NOT EXISTS idx_cash_movements_ref
  ON public.cash_movements(reference_type, reference_id);

-- ── 2-E  RLS ──────────────────────────────────────────────────
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'cash_movements'
       AND policyname = 'cash_movements_tenant_access'
  ) THEN
    CREATE POLICY "cash_movements_tenant_access" ON public.cash_movements
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
-- 3. open_cash_session RPC
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.open_cash_session(
  p_tenant_id      uuid,
  p_warehouse_id   uuid    DEFAULT NULL,
  p_opening_amount numeric DEFAULT 0,
  p_notes          text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid;
  v_session_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships
     WHERE tenant_id = p_tenant_id AND user_id = v_user_id
       AND is_active = true AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Sin permisos para abrir sesión de caja.';
  END IF;

  IF p_opening_amount < 0 THEN
    RAISE EXCEPTION 'El monto inicial no puede ser negativo.';
  END IF;

  IF p_warehouse_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM cash_sessions
       WHERE tenant_id    = p_tenant_id
         AND warehouse_id = p_warehouse_id
         AND status       = 'open'
    ) THEN
      RAISE EXCEPTION 'Ya existe una sesión de caja abierta para esta bodega.';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM cash_sessions
       WHERE tenant_id    = p_tenant_id
         AND warehouse_id IS NULL
         AND status       = 'open'
    ) THEN
      RAISE EXCEPTION 'Ya existe una sesión de caja abierta.';
    END IF;
  END IF;

  INSERT INTO cash_sessions (
    tenant_id, warehouse_id, status,
    opened_by, opening_amount, notes
  )
  VALUES (
    p_tenant_id, p_warehouse_id, 'open',
    v_user_id, COALESCE(p_opening_amount, 0),
    NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_cash_session FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.open_cash_session TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 4. close_cash_session RPC
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.close_cash_session(
  p_tenant_id    uuid,
  p_session_id   uuid,
  p_counted_cash numeric,
  p_notes        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid;
  v_status      text;
  v_opening_amt numeric(12,2);
  v_expected    numeric(12,2);
  v_variance    numeric(12,2);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships
     WHERE tenant_id = p_tenant_id AND user_id = v_user_id
       AND is_active = true AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Sin permisos para cerrar sesión de caja.';
  END IF;

  IF p_counted_cash < 0 THEN
    RAISE EXCEPTION 'El efectivo contado no puede ser negativo.';
  END IF;

  SELECT status, opening_amount
    INTO v_status, v_opening_amt
    FROM cash_sessions
   WHERE id        = p_session_id
     AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de caja no encontrada.'; END IF;
  IF v_status = 'closed' THEN RAISE EXCEPTION 'La sesión ya está cerrada.'; END IF;

  SELECT v_opening_amt + COALESCE(SUM(direction * amount), 0)
    INTO v_expected
    FROM cash_movements
   WHERE cash_session_id = p_session_id
     AND tenant_id       = p_tenant_id;

  v_variance := p_counted_cash - v_expected;

  UPDATE cash_sessions
     SET status        = 'closed',
         closed_by     = v_user_id,
         closed_at     = now(),
         counted_cash  = p_counted_cash,
         expected_cash = v_expected,
         variance      = v_variance,
         notes         = NULLIF(trim(COALESCE(p_notes, '')), '')
   WHERE id        = p_session_id
     AND tenant_id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.close_cash_session FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.close_cash_session TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 5. add_manual_cash_movement RPC
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.add_manual_cash_movement(
  p_tenant_id     uuid,
  p_session_id    uuid,
  p_movement_type text,    -- 'paid_in' | 'paid_out'
  p_amount        numeric,
  p_reason        text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid;
  v_sess_status text;
  v_movement_id uuid;
  v_direction   integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_memberships
     WHERE tenant_id = p_tenant_id AND user_id = v_user_id
       AND is_active = true AND role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Sin permisos para registrar movimientos manuales de caja.';
  END IF;

  IF p_movement_type NOT IN ('paid_in', 'paid_out') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido: %.', p_movement_type;
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor que cero.';
  END IF;

  IF trim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'El motivo es requerido para movimientos manuales de caja.';
  END IF;

  SELECT status INTO v_sess_status
    FROM cash_sessions
   WHERE id        = p_session_id
     AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de caja no encontrada.'; END IF;
  IF v_sess_status = 'closed' THEN RAISE EXCEPTION 'La sesión de caja está cerrada.'; END IF;

  v_direction := CASE p_movement_type WHEN 'paid_in' THEN 1 ELSE -1 END;

  INSERT INTO cash_movements (
    tenant_id, cash_session_id, movement_type, direction,
    amount, reason, created_by
  )
  VALUES (
    p_tenant_id, p_session_id, p_movement_type, v_direction,
    p_amount, trim(p_reason), v_user_id
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_manual_cash_movement FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.add_manual_cash_movement TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 6. create_sale — adds p_cash_session_id
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.create_sale(uuid, uuid, uuid, jsonb, jsonb, text, text, date);

CREATE OR REPLACE FUNCTION public.create_sale(
  p_tenant_id       uuid,
  p_customer_id     uuid,
  p_warehouse_id    uuid,
  p_items           jsonb,
  p_payments        jsonb,
  p_notes           text     DEFAULT NULL,
  p_document_kind   text     DEFAULT 'ticket',
  p_sale_date       date     DEFAULT NULL,
  p_cash_session_id uuid     DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          uuid;
  v_sale_id          uuid;
  v_tier_id          uuid;
  v_is_privileged    boolean;
  v_item             jsonb;
  v_payment          jsonb;
  v_product_id       uuid;
  v_presentation_id  uuid;
  v_quantity         numeric(12,4);
  v_base_qty         numeric(12,4);
  v_inv_qty          numeric(12,4);
  v_discount         numeric(12,2);
  v_unit_price       numeric(12,2);
  v_original_price   numeric(12,2);
  v_override_price   numeric(12,2);
  v_override_type    text;
  v_override_reason  text;
  v_override_note    text;
  v_tax_rate         numeric(5,2);
  v_has_tax          boolean;
  v_track_inv        boolean;
  v_line_gross       numeric(12,2);
  v_line_net         numeric(12,2);
  v_line_iva         numeric(12,2);
  v_product_name     text;
  v_stock_avail      numeric(12,2);
  v_total_gross      numeric(12,2) := 0;
  v_total_net        numeric(12,2) := 0;
  v_total_iva        numeric(12,2) := 0;
  v_total_disc       numeric(12,2) := 0;
  v_pmt_total        numeric(12,2) := 0;
  v_cash_total       numeric(12,2) := 0;
  v_sess_status       text;
  v_sess_warehouse_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  SELECT CASE WHEN role IN ('owner', 'admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM tenant_memberships
   WHERE tenant_id = p_tenant_id AND user_id = v_user_id AND is_active = true;

  IF v_is_privileged IS NULL THEN RAISE EXCEPTION 'Sin acceso a este tenant.'; END IF;

  -- Validate cash session: status + warehouse coherence.
  -- The session's warehouse_id must exactly match the sale's p_warehouse_id:
  --   both NULL  → tenant-level session on a no-warehouse sale: allowed.
  --   both equal → same warehouse: allowed.
  --   any other combination → cash would cross warehouse boundaries: rejected.
  IF p_cash_session_id IS NOT NULL THEN
    SELECT status, warehouse_id
      INTO v_sess_status, v_sess_warehouse_id
      FROM cash_sessions
     WHERE id = p_cash_session_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de caja no encontrada.'; END IF;
    IF v_sess_status <> 'open' THEN RAISE EXCEPTION 'La sesión de caja no está abierta.'; END IF;

    IF NOT (
      (v_sess_warehouse_id IS NULL     AND p_warehouse_id IS NULL) OR
      (v_sess_warehouse_id IS NOT NULL AND p_warehouse_id IS NOT NULL
       AND v_sess_warehouse_id = p_warehouse_id)
    ) THEN
      RAISE EXCEPTION 'La sesión de caja no corresponde a la bodega de esta venta.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM business_partners
     WHERE id = p_customer_id AND tenant_id = p_tenant_id AND is_active = true
  ) THEN RAISE EXCEPTION 'Cliente no encontrado o inactivo.'; END IF;

  IF p_warehouse_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM warehouses WHERE id = p_warehouse_id AND tenant_id = p_tenant_id
  ) THEN RAISE EXCEPTION 'Bodega no válida.'; END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta requiere al menos un ítem.';
  END IF;

  SELECT id INTO v_tier_id FROM price_tiers
   WHERE tenant_id = p_tenant_id AND code = 'PUBLICO' LIMIT 1;

  IF p_warehouse_id IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity   := (v_item->>'quantity')::numeric;
      v_base_qty   := COALESCE((v_item->>'base_qty')::numeric, 1);
      v_inv_qty    := v_quantity * v_base_qty;

      SELECT p.track_inventory, p.name INTO v_track_inv, v_product_name
        FROM products p
       WHERE p.id = v_product_id AND p.tenant_id = p_tenant_id AND p.is_active = true;

      IF v_product_name IS NULL THEN
        RAISE EXCEPTION 'Producto % no encontrado o inactivo.', v_product_id;
      END IF;

      IF v_track_inv THEN
        SELECT COALESCE(quantity_on_hand, 0) INTO v_stock_avail
          FROM inventory_balances
         WHERE product_id = v_product_id AND warehouse_id = p_warehouse_id AND tenant_id = p_tenant_id;
        v_stock_avail := COALESCE(v_stock_avail, 0);
        IF v_stock_avail < v_inv_qty THEN
          RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %.',
            v_product_name, v_stock_avail, v_inv_qty;
        END IF;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO sales (
    tenant_id, customer_id, warehouse_id, created_by_user_id,
    document_kind, status, notes, sale_date, subtotal, discount_total, tax_total, total
  ) VALUES (
    p_tenant_id, p_customer_id, p_warehouse_id, v_user_id,
    COALESCE(p_document_kind, 'ticket'), 'confirmed', p_notes,
    COALESCE(p_sale_date, CURRENT_DATE), 0, 0, 0, 0
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id      := (v_item->>'product_id')::uuid;
    v_presentation_id := (v_item->>'presentation_id')::uuid;
    v_quantity        := (v_item->>'quantity')::numeric;
    v_base_qty        := COALESCE((v_item->>'base_qty')::numeric, 1);
    v_inv_qty         := v_quantity * v_base_qty;
    v_discount        := COALESCE((v_item->>'discount_amount')::numeric, 0);
    v_override_price  := NULLIF(v_item->>'override_unit_price', '')::numeric;
    v_override_type   := v_item->>'price_override_type';
    v_override_reason := v_item->>'price_override_reason';
    v_override_note   := v_item->>'price_override_note';

    SELECT COALESCE(pres.unit_price, pp.unit_price, p.default_price, 0),
           COALESCE(p.tax_rate, 15), COALESCE(p.has_tax, true),
           COALESCE(p.track_inventory, true), p.name
      INTO v_unit_price, v_tax_rate, v_has_tax, v_track_inv, v_product_name
      FROM products p
      LEFT JOIN product_prices pp
             ON pp.product_id = p.id AND pp.price_tier_id = v_tier_id
            AND pp.valid_to IS NULL AND pp.tenant_id = p_tenant_id
      LEFT JOIN product_presentations pres
             ON pres.id = v_presentation_id AND pres.product_id = p.id
            AND pres.tenant_id = p_tenant_id AND pres.is_active = true
     WHERE p.id = v_product_id AND p.tenant_id = p_tenant_id;

    IF v_override_price IS NOT NULL THEN
      IF v_override_price < 0 THEN
        RAISE EXCEPTION 'Precio de ajuste no puede ser negativo para "%".', v_product_name;
      END IF;
      IF trim(COALESCE(v_override_reason, '')) = '' THEN
        RAISE EXCEPTION 'Se requiere una razón al ajustar el precio de "%".', v_product_name;
      END IF;
      IF NOT v_is_privileged AND v_unit_price > 0 THEN
        IF v_override_price < v_unit_price * 0.70 THEN
          RAISE EXCEPTION 'Descuento máximo permitido es 30%% del precio de lista para "%".', v_product_name;
        END IF;
      END IF;
      v_original_price := v_unit_price;
      v_unit_price     := v_override_price;
    ELSE
      v_original_price := NULL;
    END IF;

    v_line_gross := GREATEST(ROUND(v_quantity * v_unit_price - v_discount, 2), 0);
    v_total_disc := v_total_disc + v_discount;

    IF v_has_tax AND v_tax_rate > 0 THEN
      v_line_net := ROUND(v_line_gross / (1 + v_tax_rate / 100), 2);
      v_line_iva := ROUND(v_line_gross - v_line_net, 2);
    ELSE
      v_line_net := v_line_gross;
      v_line_iva := 0;
    END IF;

    v_total_gross := v_total_gross + v_line_gross;
    v_total_net   := v_total_net   + v_line_net;
    v_total_iva   := v_total_iva   + v_line_iva;

    INSERT INTO sale_items (
      tenant_id, sale_id, product_id, presentation_id, base_qty,
      quantity, unit_price, discount_amount, tax_rate, line_total, is_taxable,
      original_unit_price, price_override_type, price_override_reason, price_override_note,
      price_override_by, price_override_at
    ) VALUES (
      p_tenant_id, v_sale_id, v_product_id, v_presentation_id, v_base_qty,
      v_quantity, v_unit_price, v_discount,
      CASE WHEN v_has_tax THEN v_tax_rate ELSE 0 END,
      v_line_gross, v_has_tax,
      v_original_price,
      v_override_type, v_override_reason, v_override_note,
      CASE WHEN v_original_price IS NOT NULL THEN v_user_id ELSE NULL END,
      CASE WHEN v_original_price IS NOT NULL THEN now()     ELSE NULL END
    );

    IF v_track_inv AND p_warehouse_id IS NOT NULL THEN
      INSERT INTO inventory_movements (
        tenant_id, warehouse_id, product_id, movement_type, quantity, reason,
        direction, reference_type, reference_id, performed_by_user_id
      ) VALUES (
        p_tenant_id, p_warehouse_id, v_product_id, 'sale', v_inv_qty, 'Venta POS',
        -1, 'sale', v_sale_id, v_user_id
      );
      UPDATE inventory_balances
         SET quantity_on_hand = quantity_on_hand - v_inv_qty, updated_at = now()
       WHERE tenant_id = p_tenant_id AND warehouse_id = p_warehouse_id AND product_id = v_product_id;
    END IF;
  END LOOP;

  UPDATE sales
     SET subtotal = v_total_net, discount_total = v_total_disc,
         tax_total = v_total_iva, total = v_total_gross
   WHERE id = v_sale_id;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_pmt_total := v_pmt_total + COALESCE((v_payment->>'amount')::numeric, 0);
    IF v_payment->>'method' = 'cash' THEN
      v_cash_total := v_cash_total + COALESCE((v_payment->>'amount')::numeric, 0);
    END IF;
    INSERT INTO sale_payments (tenant_id, sale_id, payment_method, amount, reference)
    VALUES (
      p_tenant_id, v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::numeric,
      v_payment->>'reference'
    );
  END LOOP;

  IF v_pmt_total < v_total_gross - 0.01 THEN
    RAISE EXCEPTION 'Pago insuficiente: pagado $%, total $%.', v_pmt_total, v_total_gross;
  END IF;

  IF p_cash_session_id IS NOT NULL AND v_cash_total > 0 THEN
    INSERT INTO cash_movements (
      tenant_id, cash_session_id, movement_type, direction,
      amount, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_tenant_id, p_cash_session_id, 'cash_in', 1,
      v_cash_total, 'Venta en efectivo', 'sale', v_sale_id, v_user_id
    );
  END IF;

  RETURN v_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_sale TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 7. void_sale — adds p_cash_session_id
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.void_sale(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.void_sale(
  p_tenant_id       uuid,
  p_sale_id         uuid,
  p_reason          text,
  p_note            text DEFAULT NULL,
  p_cash_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            uuid;
  v_is_privileged      boolean;
  v_sale_status        text;
  v_warehouse_id       uuid;
  v_item               record;
  v_inv_qty            numeric(12,4);
  v_cash_refund        numeric(12,2);
  v_sess_status        text;
  v_sess_warehouse_id  uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  SELECT CASE WHEN role IN ('owner', 'admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM tenant_memberships
   WHERE tenant_id = p_tenant_id AND user_id = v_user_id AND is_active = true;

  IF v_is_privileged IS NULL THEN RAISE EXCEPTION 'Sin acceso a este tenant.'; END IF;
  IF NOT v_is_privileged THEN RAISE EXCEPTION 'Sin permisos para anular ventas.'; END IF;

  IF trim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Se requiere un motivo para anular la venta.';
  END IF;

  -- Load the sale first — warehouse_id is needed for the session coherence check below.
  SELECT status, warehouse_id INTO v_sale_status, v_warehouse_id
    FROM sales WHERE id = p_sale_id AND tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.'; END IF;
  IF v_sale_status = 'cancelled' THEN RAISE EXCEPTION 'La venta ya está anulada.'; END IF;
  IF v_sale_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Solo se pueden anular ventas confirmadas. Estado actual: %.', v_sale_status;
  END IF;

  -- Validate cash session: status + warehouse coherence against the sale's warehouse.
  IF p_cash_session_id IS NOT NULL THEN
    SELECT status, warehouse_id
      INTO v_sess_status, v_sess_warehouse_id
      FROM cash_sessions WHERE id = p_cash_session_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de caja no encontrada.'; END IF;
    IF v_sess_status <> 'open' THEN RAISE EXCEPTION 'La sesión de caja no está abierta.'; END IF;

    IF NOT (
      (v_sess_warehouse_id IS NULL     AND v_warehouse_id IS NULL) OR
      (v_sess_warehouse_id IS NOT NULL AND v_warehouse_id IS NOT NULL
       AND v_sess_warehouse_id = v_warehouse_id)
    ) THEN
      RAISE EXCEPTION 'La sesión de caja no corresponde a la bodega de esta venta.';
    END IF;
  END IF;

  UPDATE sales
     SET status              = 'cancelled',
         cancelled_at        = now(),
         cancelled_by        = v_user_id,
         cancellation_reason = trim(p_reason),
         cancellation_note   = NULLIF(trim(COALESCE(p_note, '')), '')
   WHERE id = p_sale_id AND tenant_id = p_tenant_id;

  IF v_warehouse_id IS NOT NULL THEN
    FOR v_item IN
      SELECT si.product_id, si.quantity, COALESCE(si.base_qty, 1) AS base_qty, p.track_inventory
        FROM sale_items si
        JOIN products p ON p.id = si.product_id AND p.tenant_id = si.tenant_id
       WHERE si.sale_id = p_sale_id AND si.tenant_id = p_tenant_id
    LOOP
      IF v_item.track_inventory THEN
        v_inv_qty := v_item.quantity * v_item.base_qty;

        INSERT INTO inventory_movements (
          tenant_id, warehouse_id, product_id, movement_type, quantity, reason,
          direction, reference_type, reference_id, performed_by_user_id
        ) VALUES (
          p_tenant_id, v_warehouse_id, v_item.product_id,
          'sale_reversal', v_inv_qty, 'Anulación de venta', 1,
          'sale', p_sale_id, v_user_id
        );

        INSERT INTO inventory_balances (tenant_id, warehouse_id, product_id, quantity_on_hand)
        VALUES (p_tenant_id, v_warehouse_id, v_item.product_id, v_inv_qty)
        ON CONFLICT (tenant_id, warehouse_id, product_id)
        DO UPDATE SET
          quantity_on_hand = inventory_balances.quantity_on_hand + v_inv_qty,
          updated_at = now();
      END IF;
    END LOOP;
  END IF;

  IF p_cash_session_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_cash_refund
      FROM sale_payments
     WHERE sale_id = p_sale_id AND tenant_id = p_tenant_id AND payment_method = 'cash';

    IF v_cash_refund > 0 THEN
      INSERT INTO cash_movements (
        tenant_id, cash_session_id, movement_type, direction,
        amount, reason, reference_type, reference_id, created_by
      ) VALUES (
        p_tenant_id, p_cash_session_id, 'cash_out', -1,
        v_cash_refund, 'Anulación de venta - Efectivo', 'void_sale', p_sale_id, v_user_id
      );
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.void_sale FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.void_sale TO authenticated;


-- ══════════════════════════════════════════════════════════════
-- 8. create_sale_return — adds p_cash_session_id
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.create_sale_return(uuid, uuid, jsonb, text, text, numeric, text, text, uuid);

CREATE OR REPLACE FUNCTION public.create_sale_return(
  p_tenant_id        uuid,
  p_sale_id          uuid,
  p_items            jsonb,
  p_reason           text,
  p_notes            text    DEFAULT NULL,
  p_refund_amount    numeric DEFAULT NULL,
  p_refund_method    text    DEFAULT NULL,
  p_refund_reference text    DEFAULT NULL,
  p_exchange_sale_id uuid    DEFAULT NULL,
  p_cash_session_id  uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            uuid;
  v_is_privileged      boolean;
  v_sale_status        text;
  v_warehouse_id       uuid;
  v_sale_return_id     uuid;
  v_item               jsonb;
  v_sale_item_id       uuid;
  v_quantity_ret       numeric(12,4);
  v_restock            boolean;
  v_si_quantity        numeric(12,4);
  v_si_unit_price      numeric(12,2);
  v_si_line_total      numeric(12,2);
  v_si_base_qty        numeric(12,4);
  v_si_product_id      uuid;
  v_si_track_inv       boolean;
  v_already_ret        numeric(12,4);
  v_available          numeric(12,4);
  v_inv_qty            numeric(12,4);
  v_line_refund        numeric(12,2);
  v_total_refund       numeric(12,2) := 0;
  v_this_batch         numeric(12,4) := 0;
  v_return_type        text;
  v_all_sold           numeric(12,4);
  v_all_returned       numeric(12,4);
  v_final_refund       numeric(12,2);
  v_sess_status        text;
  v_sess_warehouse_id  uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'No autenticado.'; END IF;

  SELECT CASE WHEN role IN ('owner', 'admin') THEN true ELSE false END
    INTO v_is_privileged
    FROM public.tenant_memberships
   WHERE tenant_id = p_tenant_id AND user_id = v_user_id AND is_active = true;

  IF v_is_privileged IS NULL THEN RAISE EXCEPTION 'Sin acceso a este tenant.'; END IF;
  IF NOT v_is_privileged THEN RAISE EXCEPTION 'Sin permisos para procesar devoluciones.'; END IF;

  IF trim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'Se requiere un motivo para la devolución.'; END IF;
  IF p_refund_method IS NOT NULL AND p_refund_method NOT IN ('cash', 'transfer', 'store_credit') THEN
    RAISE EXCEPTION 'Método de reembolso inválido: %.', p_refund_method;
  END IF;
  IF p_refund_amount IS NOT NULL AND p_refund_amount < 0 THEN
    RAISE EXCEPTION 'El monto de reembolso no puede ser negativo.';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La devolución requiere al menos un ítem.';
  END IF;

  -- Load the sale first — warehouse_id is needed for the session coherence check below.
  SELECT status, warehouse_id INTO v_sale_status, v_warehouse_id
    FROM public.sales WHERE id = p_sale_id AND tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada.'; END IF;
  IF v_sale_status = 'cancelled' THEN RAISE EXCEPTION 'No se puede devolver una venta anulada.'; END IF;
  IF v_sale_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Solo se pueden devolver ventas confirmadas. Estado actual: %.', v_sale_status;
  END IF;

  -- Validate cash session: status + warehouse coherence against the sale's warehouse.
  IF p_cash_session_id IS NOT NULL THEN
    SELECT status, warehouse_id
      INTO v_sess_status, v_sess_warehouse_id
      FROM cash_sessions WHERE id = p_cash_session_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sesión de caja no encontrada.'; END IF;
    IF v_sess_status <> 'open' THEN RAISE EXCEPTION 'La sesión de caja no está abierta.'; END IF;

    IF NOT (
      (v_sess_warehouse_id IS NULL     AND v_warehouse_id IS NULL) OR
      (v_sess_warehouse_id IS NOT NULL AND v_warehouse_id IS NOT NULL
       AND v_sess_warehouse_id = v_warehouse_id)
    ) THEN
      RAISE EXCEPTION 'La sesión de caja no corresponde a la bodega de esta venta.';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sale_item_id := (v_item->>'sale_item_id')::uuid;
    v_quantity_ret := (v_item->>'quantity_returned')::numeric;
    v_restock      := COALESCE((v_item->>'restock')::boolean, true);

    IF NOT v_restock AND NOT v_is_privileged THEN
      RAISE EXCEPTION 'Sin permisos para marcar productos como no reingresables al stock.';
    END IF;
    IF v_quantity_ret IS NULL OR v_quantity_ret <= 0 THEN
      RAISE EXCEPTION 'La cantidad a devolver debe ser mayor que cero.';
    END IF;

    SELECT si.quantity, si.base_qty, si.product_id
      INTO v_si_quantity, v_si_base_qty, v_si_product_id
      FROM public.sale_items si
     WHERE si.id = v_sale_item_id AND si.sale_id = p_sale_id AND si.tenant_id = p_tenant_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Ítem de venta % no encontrado en esta venta.', v_sale_item_id; END IF;

    SELECT COALESCE(SUM(sri.quantity_returned), 0) INTO v_already_ret
      FROM public.sale_return_items sri
      JOIN public.sale_returns sr ON sr.id = sri.sale_return_id
     WHERE sri.sale_item_id = v_sale_item_id AND sr.tenant_id = p_tenant_id;

    v_available := v_si_quantity - v_already_ret;
    IF v_quantity_ret > v_available THEN
      RAISE EXCEPTION 'Cantidad a devolver (%) excede lo disponible (%) para el ítem %.',
        v_quantity_ret, v_available, v_sale_item_id;
    END IF;
    v_this_batch := v_this_batch + v_quantity_ret;
  END LOOP;

  IF p_exchange_sale_id IS NOT NULL THEN
    v_return_type := 'exchange';
  ELSE
    SELECT COALESCE(SUM(si.quantity), 0) INTO v_all_sold
      FROM public.sale_items si WHERE si.sale_id = p_sale_id AND si.tenant_id = p_tenant_id;
    SELECT COALESCE(SUM(sri.quantity_returned), 0) INTO v_all_returned
      FROM public.sale_return_items sri
      JOIN public.sale_returns sr ON sr.id = sri.sale_return_id
     WHERE sr.original_sale_id = p_sale_id AND sr.tenant_id = p_tenant_id;
    v_return_type := CASE WHEN (v_all_returned + v_this_batch) >= v_all_sold THEN 'full' ELSE 'partial' END;
  END IF;

  INSERT INTO public.sale_returns (
    tenant_id, original_sale_id, return_type, status, reason, notes,
    refund_amount, refund_method, refund_reference, exchange_sale_id, warehouse_id, processed_by
  ) VALUES (
    p_tenant_id, p_sale_id, v_return_type, 'completed',
    trim(p_reason), NULLIF(trim(COALESCE(p_notes, '')), ''),
    0, p_refund_method, NULLIF(trim(COALESCE(p_refund_reference, '')), ''),
    p_exchange_sale_id, v_warehouse_id, v_user_id
  ) RETURNING id INTO v_sale_return_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sale_item_id := (v_item->>'sale_item_id')::uuid;
    v_quantity_ret := (v_item->>'quantity_returned')::numeric;
    v_restock      := COALESCE((v_item->>'restock')::boolean, true);

    SELECT si.quantity, si.unit_price, si.line_total, si.base_qty, si.product_id
      INTO v_si_quantity, v_si_unit_price, v_si_line_total, v_si_base_qty, v_si_product_id
      FROM public.sale_items si
     WHERE si.id = v_sale_item_id AND si.sale_id = p_sale_id AND si.tenant_id = p_tenant_id;

    IF v_si_quantity > 0 THEN
      IF v_quantity_ret = v_si_quantity THEN
        v_line_refund := COALESCE(v_si_line_total, 0);
      ELSE
        v_line_refund := ROUND(COALESCE(v_si_line_total, 0) / v_si_quantity * v_quantity_ret, 2);
      END IF;
    ELSE
      v_line_refund := 0;
    END IF;

    v_total_refund := v_total_refund + v_line_refund;
    v_inv_qty      := v_quantity_ret * COALESCE(v_si_base_qty, 1);

    INSERT INTO public.sale_return_items (
      tenant_id, sale_return_id, sale_item_id, product_id,
      quantity_returned, base_qty, unit_price, line_refund, restock
    ) VALUES (
      p_tenant_id, v_sale_return_id, v_sale_item_id, v_si_product_id,
      v_quantity_ret, COALESCE(v_si_base_qty, 1), v_si_unit_price, v_line_refund, v_restock
    );

    IF v_restock AND v_warehouse_id IS NOT NULL THEN
      SELECT COALESCE(p.track_inventory, false) INTO v_si_track_inv
        FROM public.products p WHERE p.id = v_si_product_id AND p.tenant_id = p_tenant_id;

      IF v_si_track_inv THEN
        INSERT INTO public.inventory_movements (
          tenant_id, warehouse_id, product_id, movement_type, quantity, reason,
          direction, reference_type, reference_id, performed_by_user_id
        ) VALUES (
          p_tenant_id, v_warehouse_id, v_si_product_id, 'return', v_inv_qty,
          'Devolución de venta', 1, 'sale_return', v_sale_return_id, v_user_id
        );
        INSERT INTO public.inventory_balances (tenant_id, warehouse_id, product_id, quantity_on_hand)
        VALUES (p_tenant_id, v_warehouse_id, v_si_product_id, v_inv_qty)
        ON CONFLICT (tenant_id, warehouse_id, product_id)
        DO UPDATE SET
          quantity_on_hand = public.inventory_balances.quantity_on_hand + EXCLUDED.quantity_on_hand,
          updated_at = now();
      END IF;
    END IF;
  END LOOP;

  IF p_refund_amount IS NOT NULL AND p_refund_amount > v_total_refund THEN
    RAISE EXCEPTION 'El monto de reembolso ($%) no puede superar el total calculado por líneas ($%).',
      p_refund_amount, v_total_refund;
  END IF;

  v_final_refund := COALESCE(p_refund_amount, v_total_refund);

  UPDATE public.sale_returns SET refund_amount = v_final_refund WHERE id = v_sale_return_id;

  IF p_cash_session_id IS NOT NULL AND p_refund_method = 'cash' AND v_final_refund > 0 THEN
    INSERT INTO cash_movements (
      tenant_id, cash_session_id, movement_type, direction,
      amount, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_tenant_id, p_cash_session_id, 'cash_out', -1,
      v_final_refund, 'Devolución de venta - Efectivo', 'sale_return', v_sale_return_id, v_user_id
    );
  END IF;

  RETURN v_sale_return_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_return FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.create_sale_return TO authenticated;
