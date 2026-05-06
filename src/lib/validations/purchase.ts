import { z } from "zod";

const itemSchema = z.object({
  product_id: z.string().uuid("Producto inválido."),
  quantity: z.number().positive("Cantidad debe ser > 0."),
  unit_cost: z.number().nonnegative("Costo no puede ser negativo."),
});

const trimmedOrUndef = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length === 0 ? undefined : t;
};

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
