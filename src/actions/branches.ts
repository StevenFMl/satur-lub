"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  branchSchema,
  type BranchFieldErrors,
} from "@/lib/validations/branch";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BranchState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: BranchFieldErrors;
} | null;

/**
 * Asegura que exista una organización para el tenant. La columna
 * `branches.organization_id` es NOT NULL (vía FK compuesta), pero todavía no
 * exponemos un módulo de "Organizaciones" — usamos una organización por
 * defecto con el `business_name` del tenant. Idempotente.
 */
async function ensureDefaultOrgId(
  supabase: SupabaseClient,
  tenantId: string,
  fallbackName: string
): Promise<string> {
  const { data: existing, error: selErr } = await supabase
    .from("organizations")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing?.id) return existing.id as string;

  const { data: created, error: insErr } = await supabase
    .from("organizations")
    .insert({
      tenant_id: tenantId,
      org_name: fallbackName || "Organización principal",
    })
    .select("id")
    .single();
  if (insErr || !created?.id) {
    throw insErr ?? new Error("No se pudo crear la organización por defecto.");
  }
  return created.id as string;
}

export async function upsertBranchAction(
  _prev: BranchState,
  formData: FormData
): Promise<BranchState> {
  const parsed = branchSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    is_active: formData.get("is_active") ?? "false",
  });

  if (!parsed.success) {
    const fieldErrors: BranchFieldErrors = {};
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
    return { error: "No tienes permisos para gestionar sucursales." };
  }

  const tenantId = membership.tenant_id;
  const businessName = membership.tenants?.business_name ?? "";
  const supabase = await createClient();

  // Operaciones distintas para create vs update — `organization_id` solo se
  // resuelve al crear (no se permite mover una sucursal entre orgs vía UI).
  if (data.id) {
    const { error } = await supabase
      .from("branches")
      .update({
        branch_name: data.name,
        is_active: data.is_active,
      })
      .eq("id", data.id)
      .eq("tenant_id", tenantId);

    if (error) {
      console.error("upsertBranchAction · update:", error);
      return { error: "No se pudo guardar la sucursal." };
    }
  } else {
    let orgId: string;
    try {
      orgId = await ensureDefaultOrgId(supabase, tenantId, businessName);
    } catch (e) {
      console.error("upsertBranchAction · ensureDefaultOrgId:", e);
      return { error: "No se pudo preparar la organización del negocio." };
    }

    const { error } = await supabase.from("branches").insert({
      tenant_id: tenantId,
      organization_id: orgId,
      branch_name: data.name,
      is_active: data.is_active,
    });

    if (error) {
      console.error("upsertBranchAction · insert:", error);
      return { error: "No se pudo crear la sucursal." };
    }
  }

  revalidatePath("/dashboard/configuracion/sucursales");
  revalidatePath("/dashboard/inventario/bodegas");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Borrado lógico (soft-delete)                                       */
/* ------------------------------------------------------------------ */

export type ToggleState = { ok?: boolean; error?: string } | null;

export async function toggleBranchActiveAction(
  id: string,
  isActive: boolean
): Promise<ToggleState> {
  if (typeof id !== "string" || id.length === 0) {
    return { error: "ID inválido." };
  }

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para inactivar sucursales." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("branches")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("tenant_id", membership.tenant_id);

  if (error) {
    console.error("toggleBranchActiveAction:", error);
    return { error: "No se pudo cambiar el estado de la sucursal." };
  }

  revalidatePath("/dashboard/configuracion/sucursales");
  revalidatePath("/dashboard/inventario/bodegas");
  return { ok: true };
}
