import { z } from "zod";

const itemSchema = z.object({
  product_id: z.string().uuid("Producto inválido."),
  quantity: z.number().positive("Cantidad debe ser > 0."),
  unit_cost: z.number().nonnegative("Costo no puede ser negativo."),
  is_taxable: z.boolean().default(true),
});

const trimmedOrUndef = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
};

/**
 * Tasas de IVA válidas en Ecuador (post-reforma 2024: 0% / 12% / 15%).
 * Se expresan como porcentaje (no fracción) para alineación con SRI.
 */
export const TAX_RATES = [0, 12, 15] as const;
export type TaxRate = (typeof TAX_RATES)[number];

// Validador "money": número no negativo, finito, coercionado desde string.
// La aritmética real se delega a lib/math.ts (big.js); aquí solo validamos rango.
const money = z.coerce
  .number()
  .nonnegative("Debe ser ≥ 0.")
  .refine((n) => Number.isFinite(n), "Monto inválido.");

export const purchaseSchema = z
  .object({
    supplier_id: z.preprocess(
      (v) => (typeof v === "string" ? v : ""),
      z.string().uuid("Selecciona un proveedor.")
    ),
    warehouse_id: z.preprocess(
      trimmedOrUndef,
      z
        .string()
        .uuid("Bodega inválida.")
        .optional()
        .transform((v) => v ?? null)
    ),
    payment_method: z.preprocess(
      (v) => (typeof v === "string" ? v : ""),
      z.enum(["cash", "transfer", "credit"], {
        error: "Selecciona método de pago.",
      })
    ),
    purchase_date: z.preprocess(
      trimmedOrUndef,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de compra inválida.")
        .optional()
        .transform((v) => v ?? null)
    ),
    payment_due_date: z.preprocess(
      trimmedOrUndef,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
        .optional()
        .transform((v) => v ?? null)
    ),
    notes: z.preprocess(
      trimmedOrUndef,
      z
        .string()
        .max(500, "Máx. 500 caracteres.")
        .optional()
        .transform((v) => v ?? null)
    ),
    items: z.array(itemSchema).min(1, "Debe incluir al menos un ítem."),

    // ── Totales fiscales (calculados en UI con big.js, re-verificados aquí) ──
    tax_rate: z.preprocess(
      (v) => (v === "" || v == null ? 15 : Number(v)),
      z
        .number()
        .refine(
          (n): n is TaxRate => (TAX_RATES as readonly number[]).includes(n),
          "Tasa IVA inválida (permitidas: 0, 12, 15)."
        )
        .optional()
    ),
    is_tax_inclusive: z.preprocess((v) => v === "on" || v === true, z.boolean()),
    subtotal: money,
    tax_amount: money,
    other_charges: z.preprocess((v) => (v === "" || v == null ? 0 : v), money),
    grand_total: money,
  })
  .superRefine((d, ctx) => {
    if (d.payment_method === "credit" && !d.payment_due_date) {
      ctx.addIssue({
        code: "custom",
        path: ["payment_due_date"],
        message: "Requerido para compras a crédito.",
      });
    }
  });

export type PurchaseInput = z.infer<typeof purchaseSchema>;
export type PurchaseFieldErrors = Partial<
  Record<keyof PurchaseInput, string>
>;
