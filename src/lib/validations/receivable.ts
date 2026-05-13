import { z } from "zod";

// ── Schemas para venta fiada ────────────────────────────────────────────────

export const creditSaleSchema = z.object({
  initial_payment: z
    .number({ message: "Monto inválido." })
    .min(0, "El pago inicial no puede ser negativo."),
  initial_payment_method: z
    .enum(["cash", "card", "transfer"])
    .nullable()
    .optional(),
  initial_payment_ref: z.string().max(120).nullable().optional(),
  due_date: z.string().nullable().optional(), // ISO date string
  credit_notes: z.string().max(500).nullable().optional(),
});

export type CreditSaleInput = z.infer<typeof creditSaleSchema>;

// ── Schema para registrar un abono posterior ────────────────────────────────

export const addReceivablePaymentSchema = z.object({
  receivable_id: z.string().uuid("ID de cuenta por cobrar inválido."),
  amount: z
    .number({ message: "Monto inválido." })
    .positive("El monto del abono debe ser mayor que cero."),
  payment_method: z.enum(["cash", "card", "transfer"], {
    error: "Método de pago inválido.",
  }),
  payment_date: z.string().optional(), // ISO date string, defaults to today
  reference: z.string().max(120).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  cash_session_id: z.string().uuid().nullable().optional(),
});

export type AddReceivablePaymentInput = z.infer<
  typeof addReceivablePaymentSchema
>;

// ── Tipos de retorno para la UI ─────────────────────────────────────────────

export type ReceivableStatus =
  | "pending"
  | "partial"
  | "paid"
  | "overdue"
  | "cancelled";

export const RECEIVABLE_STATUS_LABELS: Record<ReceivableStatus, string> = {
  pending:   "Pendiente",
  partial:   "Parcial",
  paid:      "Pagado",
  overdue:   "Vencida",
  cancelled: "Cancelada",
};

export const RECEIVABLE_STATUS_TONES: Record<
  ReceivableStatus,
  "neutral" | "active" | "warning" | "danger"
> = {
  pending:   "warning",
  partial:   "warning",
  paid:      "active",
  overdue:   "danger",
  cancelled: "neutral",
};

export type ReceivableRow = {
  id:                  string;
  tenant_id:           string;
  sale_id:             string;
  customer_id:         string;
  customer_name:       string;
  customer_document:   string | null;
  customer_phone:      string | null;
  sale_date:           string;
  document_kind:       string;
  total_amount:        number;
  paid_amount:         number;
  balance_due:         number;
  status:              ReceivableStatus;
  due_date:            string | null;
  is_overdue:          boolean;
  notes:               string | null;
  created_at:          string;
};

export type ReceivablePaymentRow = {
  id:             string;
  receivable_id:  string;
  amount:         number;
  payment_method: string;
  payment_date:   string;
  reference:      string | null;
  notes:          string | null;
  registered_by:  string;
  created_at:     string;
};
