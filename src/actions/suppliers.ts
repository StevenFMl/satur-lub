"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  supplierSchema,
  type SupplierFieldErrors,
} from "@/lib/validations/supplier";

export type SupplierState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: SupplierFieldErrors;
} | null;

export async function upsertSupplierAction(
  _prev: SupplierState,
  formData: FormData
): Promise<SupplierState> {
  const parsed = supplierSchema.safeParse({
    id: formData.get("id"),
    full_name: formData.get("full_name"),
    document_type: formData.get("document_type"),
    document_number: formData.get("document_number"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    is_active: formData.get("is_active") ?? "true",
  });

  if (!parsed.success) {
    const fieldErrors: SupplierFieldErrors = {};
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
  const tenantId = membership.tenant_id;

  const supabase = await createClient();

  // partner_type SIEMPRE forzado a 'supplier' — no se acepta del cliente.
  const payload = {
    tenant_id: tenantId,
    partner_type: "supplier" as const,
    document_type: data.document_type,
    document_number: data.document_number,
    full_name: data.full_name,
    email: data.email,
    phone: data.phone,
    is_active: data.is_active,
  };

  const { error } = data.id
    ? await supabase
        .from("business_partners")
        .update(payload)
        .eq("id", data.id)
        .eq("tenant_id", tenantId)
        .eq("partner_type", "supplier")
    : await supabase.from("business_partners").insert(payload);

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      return {
        fieldErrors: {
          document_number: "Ya existe un proveedor con esta identificación.",
        },
        error: "Identificación duplicada.",
      };
    }
    console.error("upsertSupplierAction:", error);
    return { error: "No se pudo guardar el proveedor." };
  }

  revalidatePath("/dashboard/proveedores");
  revalidatePath("/dashboard/compras/nueva");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Borrado lógico (soft-delete)                                       */
/* ------------------------------------------------------------------ */

export type ToggleState = { ok?: boolean; error?: string } | null;

/**
 * Cambia `is_active` de un proveedor. Filtros server-side por `tenant_id`
 * (defensa en profundidad sobre la RLS) y por `partner_type='supplier'` para
 * evitar inactivar otros tipos de partners por error.
 */
export async function toggleSupplierActiveAction(
  id: string,
  isActive: boolean
): Promise<ToggleState> {
  if (typeof id !== "string" || id.length === 0) {
    return { error: "ID inválido." };
  }

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para inactivar proveedores." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("business_partners")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("tenant_id", membership.tenant_id)
    .eq("partner_type", "supplier");

  if (error) {
    console.error("toggleSupplierActiveAction:", error);
    return { error: "No se pudo cambiar el estado del proveedor." };
  }

  revalidatePath("/dashboard/proveedores");
  revalidatePath("/dashboard/compras/nueva");
  return { ok: true };
}
