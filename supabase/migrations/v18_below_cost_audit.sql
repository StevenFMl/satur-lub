-- v18_below_cost_audit.sql
-- Agrega columnas dedicadas de auditoría de ventas bajo costo a la tabla sales.
--
-- Motivación: el enfoque anterior guardaba el flag en sales.notes con el prefijo
-- [BAJO_COSTO], lo que dificultaba consultas y reportes eficientes.
-- Con columnas dedicadas se puede filtrar, agregar y exportar limpiamente.
--
-- COMPATIBILIDAD:
--   El UPDATE al final de esta migración backfilla los registros legacy que
--   solo tienen el flag en notes, poniendo below_cost_override = true.
--   below_cost_loss_estimated queda en 0 para esos registros (el importe no
--   se puede extraer del texto de forma confiable).

-- ── Columnas nuevas ───────────────────────────────────────────────────────────

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS below_cost_override
    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS below_cost_loss_estimated
    numeric(12,2) NOT NULL DEFAULT 0
    CONSTRAINT chk_below_cost_loss_nonneg CHECK (below_cost_loss_estimated >= 0);

-- Índice parcial: solo los registros relevantes (los demás son false)
CREATE INDEX IF NOT EXISTS idx_sales_below_cost
  ON public.sales (tenant_id, created_at DESC)
  WHERE below_cost_override = true;

-- ── Backfill de registros legacy ──────────────────────────────────────────────
-- Los registros que se guardaron con notes ILIKE '[BAJO_COSTO]%' antes de esta
-- migración reciben el flag. El monto estimado queda en 0 (no extraíble del texto).

UPDATE public.sales
  SET below_cost_override = true
WHERE notes ILIKE '[BAJO_COSTO]%'
  AND below_cost_override = false;
