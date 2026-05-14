-- ============================================================
-- v13_stock_count.sql
--
-- Sesiones de conteo físico / cycle count
--
-- Tablas:
--   stock_count_sessions  — una sesión por bodega/conteo
--   stock_count_lines     — una línea por producto en la sesión
--
-- RPC:
--   close_stock_count_session()
--     · Llama a adjust_inventory() por cada línea con diferencia
--     · Marca la sesión como cerrada con timestamp + usuario
--     · Retorna resumen: ajustes aplicados / líneas totales / contadas
--
-- Idempotencia:
--   CREATE TABLE IF NOT EXISTS · ADD COLUMN IF NOT EXISTS
--   DO $$ para constraints/policies · CREATE OR REPLACE para RPC
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. stock_count_sessions
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.stock_count_sessions (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid         NOT NULL REFERENCES public.tenants(id)     ON DELETE CASCADE,
  warehouse_id    uuid         NOT NULL REFERENCES public.warehouses(id)   ON DELETE RESTRICT,
  status          text         NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','closed')),
  notes           text,
  created_by      uuid         NOT NULL,
  closed_by       uuid,
  closed_at       timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_count_sessions_tenant
  ON public.stock_count_sessions(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_count_sessions_status
  ON public.stock_count_sessions(tenant_id, status)
  WHERE status = 'in_progress';

ALTER TABLE public.stock_count_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'stock_count_sessions'
       AND policyname = 'count_sessions_tenant_access'
  ) THEN
    CREATE POLICY "count_sessions_tenant_access" ON public.stock_count_sessions
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
-- 2. stock_count_lines
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid          NOT NULL REFERENCES public.tenants(id)               ON DELETE CASCADE,
  session_id      uuid          NOT NULL REFERENCES public.stock_count_sessions(id)  ON DELETE CASCADE,
  product_id      uuid          NOT NULL REFERENCES public.products(id)              ON DELETE RESTRICT,
  qty_system      numeric(12,4) NOT NULL,   -- snapshot at session creation
  qty_counted     numeric(12,4),            -- null = not yet counted
  note            text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT uq_count_line_product UNIQUE (session_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_count_lines_session
  ON public.stock_count_lines(tenant_id, session_id);

ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'stock_count_lines'
       AND policyname = 'count_lines_tenant_access'
  ) THEN
    CREATE POLICY "count_lines_tenant_access" ON public.stock_count_lines
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
-- 3. RPC close_stock_count_session
-- ══════════════════════════════════════════════════════════════
--
-- Flujo:
--   1. Bloquea la sesión (FOR UPDATE) y valida que no esté cerrada.
--   2. Por cada línea con qty_counted IS NOT NULL y diferencia real:
--      llama a adjust_inventory(kind='absolute', qty=qty_counted)
--      que registra el movimiento y actualiza inventory_balances.
--   3. Cierra la sesión: status='closed', closed_by, closed_at.
--   4. Retorna resumen JSON.
--
-- Nota sobre adjust_inventory:
--   No recalcula CPP — usa average_cost vigente como unit_cost del
--   movimiento. Ideal para conteo físico donde el valor real del
--   stock no ha cambiado, solo la cantidad.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.close_stock_count_session(
  p_tenant_id  uuid,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid    := auth.uid();
  v_session      record;
  v_line         record;
  v_adj_count    integer := 0;
  v_line_total   integer := 0;
  v_line_counted integer := 0;
  v_short_id     text    := left(p_session_id::text, 8);
  v_note_suffix  text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado';
  END IF;

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id es requerido';
  END IF;

  -- ── Lock + validate session ─────────────────────────────────────────────
  SELECT * INTO v_session
    FROM public.stock_count_sessions
   WHERE id = p_session_id AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión de conteo no encontrada';
  END IF;

  IF v_session.status = 'closed' THEN
    RAISE EXCEPTION 'La sesión ya está cerrada';
  END IF;

  -- ── Process lines ───────────────────────────────────────────────────────
  FOR v_line IN
    SELECT * FROM public.stock_count_lines
     WHERE session_id = p_session_id AND tenant_id = p_tenant_id
  LOOP
    v_line_total := v_line_total + 1;

    IF v_line.qty_counted IS NOT NULL THEN
      v_line_counted := v_line_counted + 1;

      -- Only call adjust_inventory when there is an actual difference
      IF round(v_line.qty_counted, 4) <> round(v_line.qty_system, 4) THEN

        v_note_suffix := 'Conteo #' || v_short_id
          || CASE
               WHEN v_line.note IS NOT NULL AND length(trim(v_line.note)) > 0
               THEN ' · ' || trim(v_line.note)
               ELSE ''
             END;

        PERFORM public.adjust_inventory(
          p_tenant_id    := p_tenant_id,
          p_warehouse_id := v_session.warehouse_id,
          p_product_id   := v_line.product_id,
          p_kind         := 'absolute',
          p_quantity     := v_line.qty_counted,
          p_unit_cost    := NULL,          -- use current average_cost
          p_reason       := 'Conteo físico',
          p_note         := v_note_suffix
        );

        v_adj_count := v_adj_count + 1;
      END IF;
    END IF;
  END LOOP;

  -- ── Close session ───────────────────────────────────────────────────────
  UPDATE public.stock_count_sessions
     SET status     = 'closed',
         closed_by  = v_user_id,
         closed_at  = now(),
         updated_at = now()
   WHERE id = p_session_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'adjustments_applied', v_adj_count,
    'lines_total',         v_line_total,
    'lines_counted',       v_line_counted,
    'lines_not_counted',   v_line_total - v_line_counted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_stock_count_session(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_stock_count_session(uuid, uuid) TO authenticated;
