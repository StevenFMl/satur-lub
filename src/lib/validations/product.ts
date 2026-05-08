import { z } from "zod";

const trimOrUndef = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
};

const toNumberOrNaN = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return 0;
  const t = v.trim();
  if (t.length === 0) return 0;
  // Aceptamos coma decimal (es-EC) → punto
  const normalized = t.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : Number.NaN;
};

export const productSchema = z.object({
  id: z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 ? v : undefined),
    z.string().uuid().optional()
  ),
  name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : ""),
    z
      .string()
      .min(2, "Nombre demasiado corto.")
      .max(120, "Máx. 120 caracteres.")
  ),
  sku: z.preprocess(
    trimOrUndef,
    z
      .string()
      .max(60, "Máx. 60 caracteres.")
      .regex(
        /^[A-Za-z0-9._-]+$/,
        "Solo letras, números, punto, guión o guión bajo."
      )
      .optional()
      .transform((v) => v ?? null)
  ),
  unit: z.preprocess(
    (v) => {
      if (typeof v !== "string") return "unidad";
      const t = v.trim();
      return t.length === 0 ? "unidad" : t;
    },
    z
      .string()
      .min(1, "Unidad requerida.")
      .max(30, "Máx. 30 caracteres.")
  ),
  cost_price: z.preprocess(
    toNumberOrNaN,
    z
      .number({ error: "Costo inválido." })
      .nonnegative("El costo no puede ser negativo.")
      .max(99_999_999.99, "Costo demasiado alto.")
  ),
  tax_rate: z.preprocess(
    toNumberOrNaN,
    z
      .number({ error: "Impuesto inválido." })
      .refine((val) => val === 0 || val === 15, {
        message: "El IVA debe ser 0% o 15%.",
      })
  ),
});

export type ProductInput = z.infer<typeof productSchema>;
export type ProductFieldErrors = Partial<Record<keyof ProductInput, string>>;

/**
 * Genera un SKU determinista a partir del nombre + sufijo aleatorio.
 *
 * Ej.: "Aceite 20W-50 Gulf" → "ACEITE-20W-50-GULF-A3F9C2"
 *
 * - Conserva alfanuméricos, colapsa el resto a "-".
 * - Sufijo de 6 hex chars para evitar colisiones (constraint
 *   `unique (tenant_id, sku)` la captura igualmente si ocurre).
 */
export function makeSkuFromName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16);
  const suffix = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `${base || "PROD"}-${suffix}`;
}
