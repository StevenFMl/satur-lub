"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  warehouseSchema,
  type WarehouseFieldErrors,
} from "@/lib/validations/warehouse";

export type WarehouseState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: WarehouseFieldErrors;
} | null;

/**
 * Crea o actualiza una bodega.
 *
 * Seguridad:
 *  - `tenant_id` se resuelve en el servidor desde la sesión activa. Nunca
 *    se acepta del FormData (sería una vía trivial de cross-tenant write).
 *  - Solo owner/admin pueden gestionar bodegas (alineado con la RLS de
 *    INSERT/UPDATE en `warehouses`).
 *  - Para UPDATE, además filtramos por `tenant_id` en la query — defensa en
 *    profundidad por si la RLS se relaja en el futuro.
 */
export async function upsertWarehouseAction(
  _prev: WarehouseState,
  formData: FormData
): Promise<WarehouseState> {
  const parsed = warehouseSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    branch_id: formData.get("branch_id"),
    is_active: formData.get("is_active") ?? "false",
  });

  if (!parsed.success) {
    const fieldErrors: WarehouseFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !(key in fieldErrors)) {
        (fieldErrors as Record<string, string>)[key] = issue.message;
      }
    }
    return { fieldErrors, error: "Revisa los campos marcados." };
  }

  const data = parsed.data;

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para gestionar bodegas." };
  }

  const tenantId = membership.tenant_id;
  const supabase = await createClient();

  const payload = {
    tenant_id: tenantId,
    name: data.name,
    branch_id: data.branch_id,
    is_active: data.is_active,
  };

  const { error } = data.id
    ? await supabase
        .from("warehouses")
        .update(payload)
        .eq("id", data.id)
        .eq("tenant_id", tenantId)
    : await supabase.from("warehouses").insert(payload);

  if (error) {
    console.error("upsertWarehouseAction:", error);
    const m = error.message.toLowerCase();
    if (m.includes("foreign key") && m.includes("branch")) {
      return {
        fieldErrors: { branch_id: "Sucursal inválida para este negocio." },
        error: "Sucursal inválida.",
      };
    }
    return { error: "No se pudo guardar la bodega." };
  }

  revalidatePath("/dashboard/inventario/infraestructura");
  revalidatePath("/dashboard/compras/nueva");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Borrado lógico (soft-delete)                                       */
/* ------------------------------------------------------------------ */

export type ToggleState = { ok?: boolean; error?: string } | null;

export async function toggleWarehouseActiveAction(
  id: string,
  isActive: boolean
): Promise<ToggleState> {
  if (typeof id !== "string" || id.length === 0) {
    return { error: "ID inválido." };
  }

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para inactivar bodegas." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("warehouses")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("tenant_id", membership.tenant_id);

  if (error) {
    console.error("toggleWarehouseActiveAction:", error);
    return { error: "No se pudo cambiar el estado de la bodega." };
  }

  revalidatePath("/dashboard/inventario/infraestructura");
  revalidatePath("/dashboard/compras/nueva");
  return { ok: true };
}


/* ------------------------------------------------------------------ */
/* Saldo Inicial / Ajuste de Inventario                               */
/* ------------------------------------------------------------------ */

export type InitialBalanceState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

export async function createInitialBalanceAction(
  _prev: InitialBalanceState,
  formData: FormData
): Promise<InitialBalanceState> {
  const productId = formData.get("product_id") as string;
  const warehouseId = formData.get("warehouse_id") as string;
  const quantityRaw = formData.get("quantity") as string;
  const unitCostRaw = formData.get("unit_cost") as string;

  const fieldErrors: Record<string, string> = {};

  if (!productId) fieldErrors.product_id = "Producto requerido.";
  if (!warehouseId) fieldErrors.warehouse_id = "Bodega requerida.";

  const quantity = Number(quantityRaw);
  if (!quantityRaw || isNaN(quantity) || quantity <= 0) {
    fieldErrors.quantity = "Cantidad debe ser mayor a 0.";
  }

  const unitCost = Number(unitCostRaw);
  if (!unitCostRaw || isNaN(unitCost) || unitCost < 0) {
    fieldErrors.unit_cost = "Costo unitario inválido.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, error: "Revisa los campos marcados." };
  }

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para realizar ajustes de stock." };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("record_stock_adjustment", {
    p_tenant_id: membership.tenant_id,
    p_warehouse_id: warehouseId,
    p_product_id: productId,
    p_quantity: quantity,
    p_unit_cost: unitCost,
    p_reason: "Saldo Inicial / Ajuste",
    p_performed_by_user_id: user.id,
  });

  if (error) {
    console.error("createInitialBalanceAction:", error);
    return { error: "Ocurrió un error al registrar el saldo inicial." };
  }

  revalidatePath("/dashboard/inventario/stock");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Ajuste de inventario con trazabilidad completa                      */
/* ------------------------------------------------------------------ */

export type AdjustInventoryResult = {
  ok?:       boolean;
  error?:    string;
  qtyBefore?: number;
  qtyAfter?:  number;
  delta?:     number;
} | null;

export async function adjustInventoryAction(input: {
  warehouse_id: string;
  product_id:   string;
  kind:         "absolute" | "relative";
  quantity:     number;
  unit_cost:    number | null;
  reason:       string;
  note:         string | null;
}): Promise<AdjustInventoryResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "Solo administradores pueden realizar ajustes de inventario." };
  }

  if (!input.warehouse_id) return { error: "Bodega requerida." };
  if (!input.product_id)   return { error: "Producto requerido." };
  if (input.reason.trim().length < 3) return { error: "El motivo es obligatorio (mín. 3 caracteres)." };

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("adjust_inventory", {
    p_tenant_id:    membership.tenant_id,
    p_warehouse_id: input.warehouse_id,
    p_product_id:   input.product_id,
    p_kind:         input.kind,
    p_quantity:     input.quantity,
    p_unit_cost:    input.unit_cost ?? null,
    p_reason:       input.reason.trim(),
    p_note:         input.note?.trim() || null,
  } as never);

  if (error) {
    console.error("adjust_inventory:", error.message);
    const msg = error.message ?? "";
    if (
      msg.startsWith("El ajuste") ||
      msg.startsWith("El motivo") ||
      msg.startsWith("Producto") ||
      msg.startsWith("Bodega") ||
      msg.startsWith("Usuario") ||
      msg.startsWith("Tipo de ajuste")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo registrar el ajuste." };
  }

  revalidatePath("/dashboard/inventario/stock");
  revalidatePath("/dashboard/inventario/movimientos");
  revalidatePath("/dashboard");

  const result = data as { qty_before: number; qty_after: number; delta: number } | null;
  return {
    ok:       true,
    qtyBefore: result?.qty_before ?? 0,
    qtyAfter:  result?.qty_after  ?? 0,
    delta:     result?.delta      ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Conteo Físico / Cycle Count                                         */
/* ------------------------------------------------------------------ */

export type CountSessionResult = {
  ok?:       boolean;
  sessionId?: string;
  error?:    string;
} | null;

export async function createCountSessionAction(
  warehouseId: string,
  notes: string | null
): Promise<CountSessionResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };
  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "Solo administradores pueden iniciar conteos físicos." };
  }
  if (!warehouseId) return { error: "Selecciona una bodega." };

  const supabase = await createClient();
  const tenantId = membership.tenant_id;

  // 1. Create session
  const { data: session, error: sessionErr } = await supabase
    .from("stock_count_sessions")
    .insert({
      tenant_id:    tenantId,
      warehouse_id: warehouseId,
      status:       "in_progress",
      notes:        notes || null,
      created_by:   user.id,
    })
    .select("id")
    .single();

  if (sessionErr || !session) {
    console.error("createCountSessionAction:", sessionErr?.message);
    return { error: "No se pudo crear la sesión de conteo." };
  }

  // 2. Snapshot inventory_balances for this warehouse as count lines
  const { data: balances, error: balErr } = await supabase
    .from("inventory_balances")
    .select("product_id, quantity_on_hand")
    .eq("tenant_id", tenantId)
    .eq("warehouse_id", warehouseId);

  if (balErr) {
    console.error("createCountSessionAction balances:", balErr.message);
    // Clean up orphan session
    await supabase.from("stock_count_sessions").delete().eq("id", session.id);
    return { error: "No se pudieron cargar las existencias de la bodega." };
  }

  if (!balances || balances.length === 0) {
    await supabase.from("stock_count_sessions").delete().eq("id", session.id);
    return { error: "La bodega seleccionada no tiene existencias registradas." };
  }

  const lines = balances.map((b) => ({
    tenant_id:   tenantId,
    session_id:  session.id,
    product_id:  b.product_id,
    qty_system:  Number(b.quantity_on_hand ?? 0),
    qty_counted: null,
    note:        null,
  }));

  const { error: linesErr } = await supabase
    .from("stock_count_lines")
    .insert(lines);

  if (linesErr) {
    console.error("createCountSessionAction lines:", linesErr.message);
    await supabase.from("stock_count_sessions").delete().eq("id", session.id);
    return { error: "No se pudieron crear las líneas de conteo." };
  }

  return { ok: true, sessionId: session.id };
}

/* ── Guardar conteos parciales ─────────────────────────────────────── */

export type SaveLinesResult = { ok?: boolean; error?: string } | null;

export async function updateCountLinesAction(
  sessionId: string,
  lines: { id: string; qty_counted: number | null; note: string | null }[]
): Promise<SaveLinesResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };
  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "Sin permisos para actualizar conteos." };
  }
  if (lines.length === 0) return { ok: true };

  const supabase = await createClient();
  const tenantId = membership.tenant_id;

  // Validate session belongs to tenant and is not closed
  const { data: sess } = await supabase
    .from("stock_count_sessions")
    .select("status")
    .eq("id", sessionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!sess) return { error: "Sesión no encontrada." };
  if (sess.status === "closed") return { error: "La sesión ya está cerrada." };

  // Batch upsert lines
  const upsertRows = lines.map((l) => ({
    id:          l.id,
    tenant_id:   tenantId,
    session_id:  sessionId,
    qty_counted: l.qty_counted,
    note:        l.note || null,
    updated_at:  new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("stock_count_lines")
    .upsert(upsertRows, { onConflict: "id" });

  if (error) {
    console.error("updateCountLinesAction:", error.message);
    return { error: "No se pudieron guardar los conteos." };
  }

  return { ok: true };
}

/* ── Cerrar sesión y aplicar ajustes ──────────────────────────────── */

export type CloseSessionResult = {
  ok?:                boolean;
  error?:             string;
  adjustmentsApplied?: number;
  linesTotal?:         number;
  linesCounted?:       number;
} | null;

export async function closeCountSessionAction(
  sessionId: string
): Promise<CloseSessionResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };
  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "Solo administradores pueden cerrar sesiones de conteo." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("close_stock_count_session", {
    p_tenant_id:  membership.tenant_id,
    p_session_id: sessionId,
  } as never);

  if (error) {
    console.error("close_stock_count_session:", error.message);
    const msg = error.message ?? "";
    if (
      msg.startsWith("La sesión") ||
      msg.startsWith("Sesión de conteo") ||
      msg.startsWith("Usuario") ||
      msg.startsWith("El ajuste")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo cerrar la sesión de conteo." };
  }

  revalidatePath("/dashboard/inventario/stock");
  revalidatePath("/dashboard/inventario/movimientos");
  revalidatePath("/dashboard/inventario/conteo");

  const result = data as {
    adjustments_applied: number;
    lines_total: number;
    lines_counted: number;
  } | null;

  return {
    ok:                 true,
    adjustmentsApplied: result?.adjustments_applied ?? 0,
    linesTotal:          result?.lines_total          ?? 0,
    linesCounted:        result?.lines_counted         ?? 0,
  };
}
