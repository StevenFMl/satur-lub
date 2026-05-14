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

// Para precios opcionales por tier: vacío → null (no se actualiza la fila
// vigente), número → se valida en el siguiente paso del schema.
const toNullableNumber = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : Number.NaN;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
};

const tierPriceOptional = z.preprocess(
  toNullableNumber,
  z
    .number({ error: "Precio inválido." })
    .nonnegative("El precio no puede ser negativo.")
    .max(99_999_999.99, "Precio demasiado alto.")
    .nullable()
);


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
  // Costo sugerido editable por el usuario. NO es el costo histórico real.
  // average_cost (CPP) y last_purchase_cost los calcula el sistema al
  // procesar recepciones de compra — no se exponen aquí.
  cost_price: z.preprocess(
    toNumberOrNaN,
    z
      .number({ error: "Costo inválido." })
      .nonnegative("El costo no puede ser negativo.")
      .max(99_999_999.99, "Costo demasiado alto.")
  ),
  // En V1 lubricadora todos los productos llevan IVA. El campo se mantiene
  // en el schema para compatibilidad con DB y acción de servidor, pero el
  // formulario siempre lo envía como true (hidden input fijo).
  has_tax: z.boolean().default(true),
  // Precios por tier: todos opcionales. null = no actualizar esa fila.
  // Si PUBLICO queda sin definir, el POS asignará $0.00 al vender.
  price_publico: tierPriceOptional,
  // MAYORISTA: precio para clientes con volumen.
  price_mayorista: tierPriceOptional,
  // DISTRIBUIDOR: precio para canal/revendedor (no es el proveedor).
  price_distribuidor: tierPriceOptional,
  // Tipos: item (físico), service (sin inventario), kit (paquete servicio),
  // bundle (combo físico). kit y bundle comparten la misma lógica de componentes.
  product_kind: z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 ? v : "item"),
    z.enum(["item", "service", "kit", "bundle"]).default("item")
  ),
  // Punto de reorden: 0 = sin mínimo configurado (no genera alerta).
  // Solo relevante para product_kind="item"; para los demás se envía 0.
  reorder_point: z.preprocess(
    toNumberOrNaN,
    z
      .number({ error: "Punto de reorden inválido." })
      .nonnegative("No puede ser negativo.")
      .max(99_999_999.9999, "Valor demasiado alto.")
      .default(0)
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
