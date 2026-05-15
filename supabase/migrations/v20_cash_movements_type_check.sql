-- v20_cash_movements_type_check.sql
--
-- PROBLEMA (SQLSTATE 23514):
--   new row for relation "cash_movements" violates check constraint
--   "cash_movements_movement_type_check"
--
-- ROOT CAUSE:
--   La tabla cash_movements fue creada directamente en el dashboard de Supabase
--   ANTES de que existiera la migration v7_cash_sessions.sql. Tenía un
--   constraint `cash_movements_movement_type_check` con valores distintos
--   (probablemente 'in'/'out', 'sale'/'refund', o similares).
--
--   Cuando v7 se aplicó, el bloque DO $$ IF NOT EXISTS detectó que el
--   constraint YA EXISTÍA y NO lo reemplazó. El código quedó insertando
--   ('cash_in', 'cash_out', 'paid_in', 'paid_out') pero el constraint
--   real en Supabase bloqueaba esos valores.
--
-- VALORES QUE USAN LOS RPCs (todos los INSERTs confirmados):
--
--   RPC                         movement_type        direction
--   ──────────────────────────  ───────────────────  ─────────
--   create_sale (venta normal)  'cash_in'            1
--   create_sale (fiado inicial) 'cash_in'            1
--   void_sale                   'cash_out'           -1
--   create_sale_return          'cash_out'           -1
--   add_receivable_payment      'cash_in'            1
--   add_manual_cash_movement    'paid_in' | 'paid_out'  1 | -1
--
-- SOLUCIÓN:
--   DROP + CREATE de todos los constraints que referencian movement_type
--   en cash_movements. Se usa DROP CONSTRAINT ... IF EXISTS para seguridad.
--   Se recrean con el conjunto completo y correcto de valores.
--
-- IDEMPOTENCIA:
--   Seguro de re-ejecutar: DROP IF EXISTS nunca falla; CREATE siempre
--   recrea con la definición correcta.
--
-- PRODUCCIÓN:
--   No toca datos existentes. Solo altera metadatos de constraints.
--   Cero downtime. Seguro aplicar con sesión de caja abierta.

-- ── 1. Eliminar TODOS los constraints que tocan movement_type ───────────────
-- Esto cubre: el constraint viejo (con valores incorrectos), el de v7
-- si se aplicó parcialmente, y el constraint de dirección combinado.

ALTER TABLE public.cash_movements
  DROP CONSTRAINT IF EXISTS cash_movements_movement_type_check;

ALTER TABLE public.cash_movements
  DROP CONSTRAINT IF EXISTS chk_cash_movement_direction;

-- También el inline CHECK que PostgreSQL genera automáticamente desde
-- la definición de columna en CREATE TABLE (nombre autogenerado).
-- Barrido por nombre de patrón vía DO block:
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.cash_movements'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) LIKE '%movement_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS %I', r.conname
    );
    RAISE NOTICE 'v20: eliminado constraint % que referenciaba movement_type.', r.conname;
  END LOOP;
END $$;

-- ── 2. Recrear constraint de movement_type con valores completos ─────────────
-- Conjunto canónico: los 4 valores usados por todos los RPCs actuales.
ALTER TABLE public.cash_movements
  ADD CONSTRAINT cash_movements_movement_type_check
    CHECK (movement_type IN ('cash_in', 'cash_out', 'paid_in', 'paid_out'));

-- ── 3. Recrear constraint de dirección coherente ─────────────────────────────
-- Asegura que direction = 1 solo con entradas, -1 solo con salidas.
-- Semántica:
--   cash_in  / paid_in  → dinero entra a caja → direction = 1
--   cash_out / paid_out → dinero sale de caja → direction = -1
ALTER TABLE public.cash_movements
  ADD CONSTRAINT chk_cash_movement_direction CHECK (
    (movement_type IN ('cash_in',  'paid_in')  AND direction =  1) OR
    (movement_type IN ('cash_out', 'paid_out') AND direction = -1)
  );

-- ── 4. Verificación inline ───────────────────────────────────────────────────
DO $$
DECLARE
  v_type_check_exists  boolean;
  v_dir_check_exists   boolean;
  v_invalid_rows       integer;
BEGIN
  -- Verificar que los constraints existen
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cash_movements'::regclass
       AND conname  = 'cash_movements_movement_type_check'
  ) INTO v_type_check_exists;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cash_movements'::regclass
       AND conname  = 'chk_cash_movement_direction'
  ) INTO v_dir_check_exists;

  IF NOT v_type_check_exists THEN
    RAISE EXCEPTION 'v20 FAILED: cash_movements_movement_type_check no se creó.';
  END IF;

  IF NOT v_dir_check_exists THEN
    RAISE EXCEPTION 'v20 FAILED: chk_cash_movement_direction no se creó.';
  END IF;

  -- Verificar que no hay filas históricas que violen el nuevo constraint
  SELECT COUNT(*) INTO v_invalid_rows
    FROM public.cash_movements
   WHERE movement_type NOT IN ('cash_in', 'cash_out', 'paid_in', 'paid_out');

  IF v_invalid_rows > 0 THEN
    RAISE EXCEPTION
      'v20 FAILED: % filas históricas con movement_type fuera del conjunto permitido. '
      'Revisar y corregir antes de continuar.',
      v_invalid_rows;
  END IF;

  RAISE NOTICE
    'v20 OK: constraints recreados. cash_in/cash_out/paid_in/paid_out habilitados.';
END $$;
