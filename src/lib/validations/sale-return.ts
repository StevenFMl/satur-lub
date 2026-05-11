import { z } from "zod";

export const REFUND_METHODS = ["cash", "transfer", "store_credit"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const REFUND_METHOD_LABELS: Record<RefundMethod, string> = {
  cash:         "Efectivo",
  transfer:     "Transferencia",
  store_credit: "Nota a favor",
};

const saleReturnItemSchema = z.object({
  sale_item_id:      z.string().uuid("ID de ítem inválido."),
  quantity_returned: z.number().positive("Cantidad debe ser > 0."),
  restock:           z.boolean().default(true),
});

export const saleReturnSchema = z.object({
  sale_id:           z.string().uuid("ID de venta inválido."),
  items:             z
    .array(saleReturnItemSchema)
    .min(1, "Selecciona al menos un ítem para devolver."),
  reason:            z
    .string()
    .min(3, "El motivo es requerido (mínimo 3 caracteres).")
    .max(300, "El motivo no puede exceder 300 caracteres."),
  notes:             z.string().max(500).optional().nullable(),
  refund_amount:     z.number().min(0, "El monto no puede ser negativo.").optional().nullable(),
  refund_method:     z.enum(REFUND_METHODS).optional().nullable(),
  refund_reference:  z.string().max(120).optional().nullable(),
  exchange_sale_id:  z.string().uuid().optional().nullable(),
});

export type SaleReturnInput = z.infer<typeof saleReturnSchema>;
export type SaleReturnItem  = z.infer<typeof saleReturnItemSchema>;
