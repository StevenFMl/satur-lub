import { z } from "zod";

const saleItemSchema = z.object({
  product_id:       z.string().uuid("Producto inválido."),
  quantity:         z.number().positive("Cantidad debe ser > 0."),
  discount_amount:  z.number().min(0, "Descuento no puede ser negativo.").default(0),
  presentation_id:  z.string().uuid().nullable().optional(),
  base_qty:         z.number().positive().default(1),
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
  payments:      z.array(salePaymentSchema).min(1, "La venta requiere al menos un pago."),
  notes:         z.string().max(500).optional().nullable(),
  document_kind: z.enum(["ticket", "invoice"]).default("ticket"),
  sale_date:     z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD).")
    .optional()
    .nullable(),
});

export type SaleInput    = z.infer<typeof saleSchema>;
export type SaleItem     = z.infer<typeof saleItemSchema>;
export type SalePayment  = z.infer<typeof salePaymentSchema>;
