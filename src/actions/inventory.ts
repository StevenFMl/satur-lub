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

  revalidatePath("/dashboard/inventario/bodegas");
  revalidatePath("/dashboard/compras/nueva");
  return { ok: true };
}
