import { z } from "zod";

export const PRICE_OVERRIDE_TYPES = [
  "price_set",
  "courtesy",
  "combo",
  "rounding",
  "damaged",
  "loyalty",
] as const;

export type PriceOverrideType = (typeof PRICE_OVERRIDE_TYPES)[number];

export const PRICE_OVERRIDE_LABELS: Record<PriceOverrideType, string> = {
  price_set: "Precio especial",
  courtesy:  "Cortesía",
  combo:     "Combo / Pack",
  rounding:  "Redondeo",
  damaged:   "Mercancía dañada",
  loyalty:   "Fidelización",
};

// Kit/bundle component shape (passed to create_sale RPC for atomic stock decrement)
export const bundleComponentSchema = z.object({
  product_id: z.string().uuid(),
  quantity:   z.number().positive(),
  base_qty:   z.number().positive().default(1),
});

export type BundleComponent = z.infer<typeof bundleComponentSchema>;

const saleItemSchema = z
  .object({
    product_id:            z.string().uuid("Producto inválido."),
    quantity:              z.number().positive("Cantidad debe ser > 0."),
    discount_amount:       z.number().min(0, "Descuento no puede ser negativo.").default(0),
    presentation_id:       z.string().uuid().nullable().optional(),
    base_qty:              z.number().positive().default(1),
    override_unit_price:   z.number().min(0, "Precio no puede ser negativo.").nullable().optional(),
    price_override_type:   z.enum(PRICE_OVERRIDE_TYPES).nullable().optional(),
    price_override_reason: z.string().max(200).nullable().optional(),
    price_override_note:   z.string().max(500).nullable().optional(),
    // For kit/bundle items: array of components to decrement in inventory
    components:            z.array(bundleComponentSchema).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.override_unit_price != null && !data.price_override_reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Se requiere un motivo al ajustar el precio.",
        path: ["price_override_reason"],
      });
    }
  });

const salePaymentSchema = z.object({
  method:    z.enum(["cash", "card", "transfer"], {
    error: "Método de pago inválido.",
  }),
  amount:    z.number().positive("Monto de pago debe ser > 0."),
  reference: z.string().max(120).optional().nullable(),
});

export const saleSchema = z.object({
  customer_id:   z.string().uuid("Cliente inválido."),
  warehouse_id:  z.string().uuid("Bodega inválida.").nullable(),
  items:         z.array(saleItemSchema).min(1, "La venta requiere al menos un ítem."),
  payments:      z.array(salePaymentSchema).min(0).default([]),
  notes:         z.string().max(500).optional().nullable(),
  document_kind: z.enum(["ticket", "invoice"]).default("ticket"),
  sale_date:     z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).")
    .optional()
    .nullable(),
  // Fiado / crédito
  is_credit:              z.boolean().optional().default(false),
  initial_payment:        z.number().min(0).optional().nullable(),
  initial_payment_method: z.enum(["cash", "card", "transfer"]).optional().nullable(),
  initial_payment_ref:    z.string().max(120).optional().nullable(),
  due_date:               z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
    .optional()
    .nullable(),
  credit_notes: z.string().max(500).optional().nullable(),
});

export type SaleInput   = z.infer<typeof saleSchema>;
export type SaleItem    = z.infer<typeof saleItemSchema>;
export type SalePayment = z.infer<typeof salePaymentSchema>;
