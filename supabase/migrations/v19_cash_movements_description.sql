-- v19_cash_movements_description.sql
--
-- PROBLEMA:
--   La tabla cash_movements en Supabase tiene una columna `description` NOT NULL
--   que no fue incluida en las migrations locales (v7_cash_sessions.sql).
--   Todos los INSERT INTO cash_movements en los RPCs (create_sale, void_sale,
--   create_sale_return, add_receivable_payment, add_manual_cash_movement)
--   rellenan `reason` pero omiten `description`, causando:
--
--     null value in column "description" of relation "cash_movements"
--     violates not-null constraint  (SQLSTATE 23502)
--
-- ESCENARIOS CUBIERTOS:
--   A) La columna description YA existe en Supabase como NOT NULL
--      → ADD COLUMN IF NOT EXISTS es no-op. El fix real es el trigger.
--   B) La columna description NO existe (entorno local / staging limpio)
--      → Se añade nullable, se hace backfill, se tightens a NOT NULL.
--
-- SOLUCIÓN DEFINITIVA:
--   1. ADD COLUMN IF NOT EXISTS (no-op si ya existe — seguro en ambos casos).
--   2. Backfill robusto: cubre NULL y cadenas vacías.
--   3. Tighten NOT NULL (solo si aún nullable — DO block idempotente).
--   4. Trigger BEFORE INSERT OR UPDATE — defensa permanente que garantiza
--      que description NUNCA llegue a NULL sin importar qué INSERT lo llame.

-- ── 1. Añadir columna (no-op si ya existe) ──────────────────────────────────
-- Si en Supabase ya existe como NOT NULL, este ADD COLUMN IF NOT EXISTS
-- simplemente no hace nada. El fix real siempre fue el trigger (paso 4).
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS description text;

-- ── 2. Backfill robusto (NULL y vacío) ──────────────────────────────────────
-- Cubre filas históricas con description ausente o en blanco.
-- Solo necesario si la columna acaba de ser añadida (escenario B);
-- si ya existía y tenía valores (escenario A) este UPDATE no toca nada.
UPDATE public.cash_movements
   SET description = COALESCE(NULLIF(trim(description), ''), reason, 'Movimiento de caja')
 WHERE description IS NULL
    OR trim(description) = '';

-- ── 3. Aplicar NOT NULL (idempotente — solo actúa si aún es nullable) ───────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'cash_movements'
       AND column_name  = 'description'
       AND is_nullable  = 'YES'
  ) THEN
    ALTER TABLE public.cash_movements
      ALTER COLUMN description SET NOT NULL;
    RAISE NOTICE 'v19: description SET NOT NULL aplicado.';
  ELSE
    RAISE NOTICE 'v19: description ya era NOT NULL en Supabase — sin cambio.';
  END IF;
END $$;

-- ── 4. Trigger de defensa permanente ────────────────────────────────────────
-- Este es el FIX REAL para el error SQLSTATE 23502.
--
-- Cualquier INSERT o UPDATE que llegue sin `description` (o con valor vacío)
-- lo auto-rellena con: COALESCE(description, reason, 'Movimiento de caja').
--
-- Protege los 11 INSERTs existentes en los RPCs sin modificarlos, y también
-- a cualquier INSERT futuro que olvide proveer la columna.
CREATE OR REPLACE FUNCTION public.cash_movements_auto_description()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.description IS NULL OR trim(NEW.description) = '' THEN
    NEW.description := COALESCE(NULLIF(trim(NEW.reason), ''), 'Movimiento de caja');
  END IF;
  RETURN NEW;
END;
$$;

-- Crear el trigger solo si no existe (idempotente)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname  = 'trg_cash_movements_auto_description'
       AND tgrelid = 'public.cash_movements'::regclass
  ) THEN
    CREATE TRIGGER trg_cash_movements_auto_description
      BEFORE INSERT OR UPDATE ON public.cash_movements
      FOR EACH ROW EXECUTE FUNCTION public.cash_movements_auto_description();
    RAISE NOTICE 'v19: trigger trg_cash_movements_auto_description creado.';
  ELSE
    RAISE NOTICE 'v19: trigger ya existía — sin cambio.';
  END IF;
END $$;

-- ── 5. Verificación inline ───────────────────────────────────────────────────
DO $$
DECLARE
  v_null_count  integer;
  v_empty_count integer;
BEGIN
  SELECT COUNT(*) INTO v_null_count
    FROM public.cash_movements
   WHERE description IS NULL;

  SELECT COUNT(*) INTO v_empty_count
    FROM public.cash_movements
   WHERE trim(description) = '';

  IF v_null_count > 0 OR v_empty_count > 0 THEN
    RAISE EXCEPTION
      'v19 FAILED: % filas con description NULL, % con description vacía.',
      v_null_count, v_empty_count;
  END IF;

  RAISE NOTICE 'v19 OK: cash_movements.description sin NULLs ni vacíos. Trigger activo.';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- NOTA PARA EL EQUIPO — FASE 2 (no bloqueante, opcional a mediano plazo)
-- ────────────────────────────────────────────────────────────────────────────
--
-- Esta migración resuelve el error de producción de forma definitiva.
-- El trigger es la defensa principal; los 11 INSERTs en los RPCs no
-- necesitan modificarse para que la venta funcione HOY.
--
-- Fase 2 recomendada (cuando haya tiempo, no urgente):
--   Actualizar los RPCs para incluir `description` explícitamente en
--   cada INSERT INTO cash_movements, usando valores semánticos:
--
--   RPC / camino                         description sugerida
--   ─────────────────────────────────────────────────────────
--   create_sale      → venta normal      'Venta POS'
--   create_sale      → fiado inicial     'Abono inicial fiado'
--   void_sale        → anulación         'Anulación de venta'
--   create_sale_return → devolución      'Devolución de venta'
--   add_receivable_payment → abono       'Abono a cuenta por cobrar'
--   add_manual_cash_movement (paid_in)   usar p_reason del usuario
--   add_manual_cash_movement (paid_out)  usar p_reason del usuario
--
--   Beneficio de fase 2: mayor claridad en reportes de caja; no cambia
--   la lógica de negocio ni los totales.
-- ────────────────────────────────────────────────────────────────────────────
