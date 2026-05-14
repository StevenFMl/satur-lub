"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { saleSchema, type SaleInput } from "@/lib/validations/sale";
import { saleReturnSchema, type SaleReturnInput } from "@/lib/validations/sale-return";
import {
  addReceivablePaymentSchema,
  type AddReceivablePaymentInput,
  type ReceivableRow,
  type ReceivablePaymentRow,
} from "@/lib/validations/receivable";

export type CreateSaleResult = {
  ok?:     boolean;
  saleId?: string;
  error?:  string;
} | null;

export type VoidSaleResult = {
  ok?:   boolean;
  error?: string;
} | null;

export type CreateSaleReturnResult = {
  ok?:        boolean;
  returnId?:  string;
  error?:     string;
} | null;

export async function createSaleAction(
  input: SaleInput,
  cashSessionId?: string | null
): Promise<CreateSaleResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Datos de venta inválidos." };
  }

  const data = parsed.data;
  const supabase = await createClient();

  const { data: saleId, error } = await supabase.rpc("create_sale", {
    p_tenant_id:              membership.tenant_id,
    p_customer_id:            data.customer_id,
    p_warehouse_id:           data.warehouse_id,
    p_items:                  data.items as never,
    p_payments:               data.payments as never,
    p_notes:                  data.notes ?? null,
    p_document_kind:          data.document_kind,
    p_sale_date:              data.sale_date ?? null,
    p_cash_session_id:        cashSessionId ?? null,
    p_is_credit:              data.is_credit ?? false,
    p_initial_payment:        data.initial_payment ?? null,
    p_initial_payment_method: data.initial_payment_method ?? null,
    p_initial_payment_ref:    data.initial_payment_ref ?? null,
    p_due_date:               data.due_date ?? null,
    p_credit_notes:           data.credit_notes ?? null,
  } as never);

  if (error) {
    console.error("createSaleAction RPC error:", error.message, error.code);
    const msg = error.message ?? "";
    if (
      msg.startsWith("Stock insuficiente") ||
      msg.startsWith("Cliente") ||
      msg.startsWith("Producto") ||
      msg.startsWith("Bodega") ||
      msg.startsWith("Pago insuficiente") ||
      msg.startsWith("La venta") ||
      msg.startsWith("No autenticado") ||
      msg.startsWith("Sin acceso") ||
      msg.startsWith("Precio de ajuste") ||
      msg.startsWith("Se requiere una razón") ||
      msg.startsWith("Descuento máximo") ||
      msg.startsWith("Sesión de caja")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo registrar la venta. Intenta de nuevo." };
  }

  revalidateTag("products");
  revalidatePath("/dashboard/pos");
  revalidatePath("/dashboard/pos/ventas");
  revalidatePath("/dashboard/pos/caja");
  revalidatePath("/dashboard/inventario/stock");
  revalidatePath("/dashboard/inventario/movimientos");

  return { ok: true, saleId: typeof saleId === "string" ? saleId : undefined };
}

export async function voidSaleAction(input: {
  sale_id:         string;
  reason:          string;
  note?:           string | null;
  cash_session_id?: string | null;
}): Promise<VoidSaleResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (!input.sale_id) return { error: "ID de venta requerido." };
  if (!input.reason?.trim()) return { error: "El motivo es requerido." };

  const supabase = await createClient();

  const { error } = await supabase.rpc("void_sale", {
    p_tenant_id:       membership.tenant_id,
    p_sale_id:         input.sale_id,
    p_reason:          input.reason.trim(),
    p_note:            input.note ?? null,
    p_cash_session_id: input.cash_session_id ?? null,
  } as never);

  if (error) {
    console.error("voidSaleAction RPC error:", error.message, error.code);
    const msg = error.message ?? "";
    if (
      msg.startsWith("No autenticado") ||
      msg.startsWith("Sin acceso") ||
      msg.startsWith("Sin permisos") ||
      msg.startsWith("Se requiere un motivo") ||
      msg.startsWith("Venta no encontrada") ||
      msg.startsWith("La venta ya está") ||
      msg.startsWith("Solo se pueden anular") ||
      msg.startsWith("Sesión de caja")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo anular la venta. Intenta de nuevo." };
  }

  revalidatePath("/dashboard/pos/ventas");
  revalidatePath(`/dashboard/pos/ventas/${input.sale_id}`);
  revalidatePath("/dashboard/pos/caja");
  revalidatePath("/dashboard/inventario/stock");
  revalidatePath("/dashboard/inventario/movimientos");

  return { ok: true };
}

export async function createSaleReturnAction(
  input: SaleReturnInput,
  cashSessionId?: string | null
): Promise<CreateSaleReturnResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "Sin permisos para procesar devoluciones." };
  }

  const parsed = saleReturnSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Datos de devolución inválidos." };
  }

  const data = parsed.data;
  const supabase = await createClient();

  const { data: returnId, error } = await supabase.rpc("create_sale_return", {
    p_tenant_id:        membership.tenant_id,
    p_sale_id:          data.sale_id,
    p_items:            data.items as never,
    p_reason:           data.reason,
    p_notes:            data.notes ?? null,
    p_refund_amount:    data.refund_amount ?? null,
    p_refund_method:    data.refund_method ?? null,
    p_refund_reference: data.refund_reference ?? null,
    p_exchange_sale_id: data.exchange_sale_id ?? null,
    p_cash_session_id:  cashSessionId ?? null,
  } as never);

  if (error) {
    console.error("createSaleReturnAction RPC error:", error.message, error.code);
    const msg = error.message ?? "";
    if (
      msg.startsWith("No autenticado") ||
      msg.startsWith("Sin acceso") ||
      msg.startsWith("Sin permisos") ||
      msg.startsWith("Se requiere un motivo") ||
      msg.startsWith("Método de reembolso") ||
      msg.startsWith("La devolución requiere") ||
      msg.startsWith("Venta no encontrada") ||
      msg.startsWith("No se puede devolver") ||
      msg.startsWith("Solo se pueden devolver") ||
      msg.startsWith("Ítem de venta") ||
      msg.startsWith("Cantidad a devolver") ||
      msg.startsWith("El monto de reembolso") ||
      msg.startsWith("Sesión de caja")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo registrar la devolución. Intenta de nuevo." };
  }

  revalidateTag("products");
  revalidatePath(`/dashboard/pos/ventas/${data.sale_id}`);
  revalidatePath("/dashboard/pos/ventas");
  revalidatePath("/dashboard/pos/caja");
  revalidatePath("/dashboard/inventario/stock");
  revalidatePath("/dashboard/inventario/movimientos");

  return { ok: true, returnId: typeof returnId === "string" ? returnId : undefined };
}

// ── Fiado / cuentas por cobrar ──────────────────────────────────────────────

export type AddReceivablePaymentResult = {
  ok?:       boolean;
  paymentId?: string;
  error?:    string;
} | null;

export async function addReceivablePaymentAction(
  input: AddReceivablePaymentInput,
  cashSessionId?: string | null
): Promise<AddReceivablePaymentResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const parsed = addReceivablePaymentSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: first?.message ?? "Datos de abono inválidos." };
  }

  const data = parsed.data;
  const supabase = await createClient();

  const { data: paymentId, error } = await supabase.rpc("add_receivable_payment", {
    p_tenant_id:       membership.tenant_id,
    p_receivable_id:   data.receivable_id,
    p_amount:          data.amount,
    p_payment_method:  data.payment_method,
    p_payment_date:    data.payment_date ?? null,
    p_reference:       data.reference ?? null,
    p_notes:           data.notes ?? null,
    p_cash_session_id: cashSessionId ?? null,
  } as never);

  if (error) {
    console.error("addReceivablePaymentAction RPC error:", error.message);
    const msg = error.message ?? "";
    if (
      msg.startsWith("No autenticado") ||
      msg.startsWith("Sin acceso") ||
      msg.startsWith("Cuenta por cobrar") ||
      msg.startsWith("Esta cuenta") ||
      msg.startsWith("El abono") ||
      msg.startsWith("Método de pago") ||
      msg.startsWith("El monto") ||
      msg.startsWith("Sesión de caja")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo registrar el abono. Intenta de nuevo." };
  }

  revalidatePath("/dashboard/pos/fiado");
  revalidatePath("/dashboard/clientes");
  revalidatePath("/dashboard/pos/caja");

  return { ok: true, paymentId: typeof paymentId === "string" ? paymentId : undefined };
}

export type GetReceivablesResult = {
  rows?:  ReceivableRow[];
  error?: string;
} | null;

export async function getCustomerReceivablesAction(
  customerId?: string | null
): Promise<GetReceivablesResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const supabase = await createClient();

  let query = supabase
    .from("v_customer_receivables")
    .select("*")
    .eq("tenant_id", membership.tenant_id)
    .order("created_at", { ascending: false });

  if (customerId) {
    query = query.eq("customer_id", customerId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("getCustomerReceivablesAction error:", error.message);
    return { error: "No se pudo cargar las cuentas por cobrar." };
  }

  return { rows: (data ?? []) as ReceivableRow[] };
}

export type GetReceivablePaymentsResult = {
  rows?:  ReceivablePaymentRow[];
  error?: string;
} | null;

export async function getReceivablePaymentsAction(
  receivableId: string
): Promise<GetReceivablePaymentsResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("customer_receivable_payments")
    .select("*")
    .eq("tenant_id", membership.tenant_id)
    .eq("receivable_id", receivableId)
    .order("payment_date", { ascending: false });

  if (error) {
    console.error("getReceivablePaymentsAction error:", error.message);
    return { error: "No se pudo cargar el historial de abonos." };
  }

  return { rows: (data ?? []) as ReceivablePaymentRow[] };
}

/* ------------------------------------------------------------------ */
/* Seguimiento de cobranza (follow-ups)                                */
/* ------------------------------------------------------------------ */

export type FollowupState = { ok?: boolean; error?: string } | null;

export async function addFollowupAction(input: {
  receivable_id:  string;
  result:         string;
  note:           string | null;
  next_followup:  string | null;
}): Promise<FollowupState> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const supabase = await createClient();

  const { error } = await supabase.rpc("add_receivable_followup", {
    p_tenant_id:     membership.tenant_id,
    p_receivable_id: input.receivable_id,
    p_result:        input.result,
    p_note:          input.note || null,
    p_next_followup: input.next_followup || null,
  } as never);

  if (error) {
    console.error("add_receivable_followup:", error.message);
    const msg = error.message ?? "";
    if (
      msg.startsWith("Cuenta") ||
      msg.startsWith("Usuario") ||
      msg.startsWith("Resultado") ||
      msg.startsWith("p_tenant_id")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo registrar la gestión." };
  }

  revalidatePath("/dashboard/pos/fiado");
  return { ok: true };
}
