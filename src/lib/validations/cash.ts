import { z } from "zod";

export const openSessionSchema = z.object({
  warehouse_id:    z.string().uuid().nullable().optional(),
  opening_amount:  z.number().min(0, "El monto inicial no puede ser negativo.").default(0),
  notes:           z.string().max(300).nullable().optional(),
});

export const closeSessionSchema = z.object({
  session_id:   z.string().uuid(),
  counted_cash: z.number().min(0, "El efectivo contado no puede ser negativo."),
  notes:        z.string().max(300).nullable().optional(),
});

export const cashMovementSchema = z.object({
  session_id:     z.string().uuid(),
  movement_type:  z.enum(["paid_in", "paid_out"]),
  amount:         z.number().positive("El monto debe ser mayor que cero."),
  reason:         z
    .string()
    .min(3, "El motivo es requerido (mínimo 3 caracteres).")
    .max(200),
});

export type OpenSessionInput   = z.infer<typeof openSessionSchema>;
export type CloseSessionInput  = z.infer<typeof closeSessionSchema>;
export type CashMovementInput  = z.infer<typeof cashMovementSchema>;

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  cash_in:  "Venta efectivo",
  cash_out: "Reembolso efectivo",
  paid_in:  "Ingreso manual",
  paid_out: "Egreso manual",
};
