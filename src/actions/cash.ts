"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  openSessionSchema,
  closeSessionSchema,
  cashMovementSchema,
  type OpenSessionInput,
  type CloseSessionInput,
  type CashMovementInput,
} from "@/lib/validations/cash";

export type CashActionResult = {
  ok?:       boolean;
  sessionId?: string;
  movementId?: string;
  error?:    string;
} | null;

const CASH_PATHS = [
  "/dashboard/pos",
  "/dashboard/pos/caja",
  "/dashboard/pos/ventas",
];

function surfaceError(msg: string): string {
  const surfaces = [
    "Sin permisos",
    "No autenticado",
    "Sin acceso",
    "Ya existe una sesión",
    "Sesión de caja no encontrada",
    "La sesión ya está cerrada",
    "La sesión de caja no está abierta",
    "El monto inicial",
    "El efectivo contado",
    "El monto debe ser mayor",
    "El motivo es requerido",
    "Tipo de movimiento inválido",
  ];
  return surfaces.some((p) => msg.startsWith(p)) ? msg : "Error al procesar la operación de caja.";
}

export async function openCashSessionAction(
  input: OpenSessionInput
): Promise<CashActionResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const parsed = openSessionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const d = parsed.data;
  const supabase = await createClient();

  const { data: sessionId, error } = await supabase.rpc("open_cash_session", {
    p_tenant_id:      membership.tenant_id,
    p_warehouse_id:   d.warehouse_id ?? null,
    p_opening_amount: d.opening_amount,
    p_notes:          d.notes ?? null,
  } as never);

  if (error) {
    console.error("openCashSessionAction:", error.message, error.code);
    return { error: surfaceError(error.message ?? "") };
  }

  for (const path of CASH_PATHS) revalidatePath(path);
  return { ok: true, sessionId: typeof sessionId === "string" ? sessionId : undefined };
}

export async function closeCashSessionAction(
  input: CloseSessionInput
): Promise<CashActionResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const parsed = closeSessionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const d = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.rpc("close_cash_session", {
    p_tenant_id:    membership.tenant_id,
    p_session_id:   d.session_id,
    p_counted_cash: d.counted_cash,
    p_notes:        d.notes ?? null,
  } as never);

  if (error) {
    console.error("closeCashSessionAction:", error.message, error.code);
    return { error: surfaceError(error.message ?? "") };
  }

  for (const path of CASH_PATHS) revalidatePath(path);
  return { ok: true };
}

export async function addCashMovementAction(
  input: CashMovementInput
): Promise<CashActionResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const parsed = cashMovementSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const d = parsed.data;
  const supabase = await createClient();

  const { data: movementId, error } = await supabase.rpc("add_manual_cash_movement", {
    p_tenant_id:     membership.tenant_id,
    p_session_id:    d.session_id,
    p_movement_type: d.movement_type,
    p_amount:        d.amount,
    p_reason:        d.reason,
  } as never);

  if (error) {
    console.error("addCashMovementAction:", error.message, error.code);
    return { error: surfaceError(error.message ?? "") };
  }

  for (const path of CASH_PATHS) revalidatePath(path);
  return { ok: true, movementId: typeof movementId === "string" ? movementId : undefined };
}
