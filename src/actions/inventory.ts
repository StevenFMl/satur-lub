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
