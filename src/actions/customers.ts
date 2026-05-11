"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  customerSchema,
  CONSUMIDOR_FINAL_DOC,
  type CustomerFieldErrors,
} from "@/lib/validations/customer";

/* ------------------------------------------------------------------ */
/* Tipos de estado                                                     */
/* ------------------------------------------------------------------ */

export type CustomerState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: CustomerFieldErrors;
} | null;

export type ToggleState = { ok?: boolean; error?: string } | null;

/* ------------------------------------------------------------------ */
/* Semilla inmutable: Consumidor Final                                 */
/* ------------------------------------------------------------------ */

/**
 * Garantiza que exista un registro "Consumidor Final" para el tenant.
 * Es idempotente: si ya existe no hace nada.
 * Se llama desde la página RSC antes de renderizar la tabla.
 */
export async function ensureConsumidorFinalAction(
  tenantId: string
): Promise<void> {
  const supabase = await createClient();

  // Verificar si ya existe
  const { data: existing } = await supabase
    .from("business_partners")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("partner_type", "customer")
    .eq("document_type", "CONSUMIDOR_FINAL")
    .eq("document_number", CONSUMIDOR_FINAL_DOC)
    .maybeSingle();

  if (existing) return;

  // Crear el registro semilla
  const { error } = await supabase.from("business_partners").insert({
    tenant_id: tenantId,
    partner_type: "customer",
    document_type: "CONSUMIDOR_FINAL",
    document_number: CONSUMIDOR_FINAL_DOC,
    full_name: "Consumidor Final",
    customer_category: "minorista",
    is_active: true,
  });

  if (error) {
    // Si el error es de duplicado, otro request ya lo creó — OK
    const m = error.message.toLowerCase();
    if (!m.includes("duplicate") && !m.includes("unique")) {
      console.error("ensureConsumidorFinalAction:", error);
    }
  }
}

/* ------------------------------------------------------------------ */
/* CRUD: Crear / Editar cliente                                        */
/* ------------------------------------------------------------------ */

export async function upsertCustomerAction(
  _prev: CustomerState,
  formData: FormData
): Promise<CustomerState> {
  const parsed = customerSchema.safeParse({
    id: formData.get("id"),
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    document_type: formData.get("document_type"),
    document_number: formData.get("document_number"),
    address: formData.get("address"),
    notes: formData.get("notes"),
    is_active: formData.get("is_active") ?? "true",
  });

  if (!parsed.success) {
    const fieldErrors: CustomerFieldErrors = {};
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

  const addressJson =
    data.address != null ? { line: data.address } : {};

  const payload = {
    tenant_id: tenantId,
    partner_type: "customer" as const,
    document_type: data.document_type,
    document_number: data.document_number,
    full_name: data.full_name,
    email: data.email,
    phone: data.phone,
    address: addressJson,
    notes: data.notes,
    is_active: data.is_active,
  };

  const { error } = data.id
    ? await supabase
        .from("business_partners")
        .update(payload)
        .eq("id", data.id)
        .eq("tenant_id", tenantId)
        .eq("partner_type", "customer")
    : await supabase.from("business_partners").insert(payload);

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      return {
        fieldErrors: {
          document_number: "Ya existe un cliente con esta identificación.",
        },
        error: "Identificación duplicada.",
      };
    }
    console.error("upsertCustomerAction:", error);
    return { error: "No se pudo guardar el cliente." };
  }

  revalidatePath("/dashboard/clientes");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Toggle activo/inactivo (soft-delete)                                */
/* ------------------------------------------------------------------ */

/**
 * Cambia `is_active` de un cliente.
 * PROTECCIÓN: No permite inactivar al "Consumidor Final".
 */
export async function toggleCustomerActiveAction(
  id: string,
  isActive: boolean
): Promise<ToggleState> {
  if (typeof id !== "string" || id.length === 0) {
    return { error: "ID inválido." };
  }

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para inactivar clientes." };
  }

  const supabase = await createClient();

  // Proteger al Consumidor Final: no se puede inactivar
  if (!isActive) {
    const { data: target } = await supabase
      .from("business_partners")
      .select("document_type, document_number")
      .eq("id", id)
      .eq("tenant_id", membership.tenant_id)
      .eq("partner_type", "customer")
      .maybeSingle();

    if (
      target?.document_type === "CONSUMIDOR_FINAL" &&
      target?.document_number === CONSUMIDOR_FINAL_DOC
    ) {
      return {
        error:
          "El registro 'Consumidor Final' es inmutable y no puede ser inactivado.",
      };
    }
  }

  const { error } = await supabase
    .from("business_partners")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("tenant_id", membership.tenant_id)
    .eq("partner_type", "customer");

  if (error) {
    console.error("toggleCustomerActiveAction:", error);
    return { error: "No se pudo cambiar el estado del cliente." };
  }

  revalidatePath("/dashboard/clientes");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Búsqueda ligera para POS picker                                     */
/* ------------------------------------------------------------------ */

export type PickedCustomer = {
  id: string;
  full_name: string;
  document_type: string;
  document_number: string;
  phone: string | null;
};

/**
 * Búsqueda rápida de clientes activos. Devuelve máximo 10 resultados.
 * Pensado para el selector del POS — debe ser rápido y liviano.
 */
export async function searchCustomersAction(
  query: string
): Promise<{ data: PickedCustomer[]; error?: string }> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { data: [], error: "Sesión expirada." };

  const supabase = await createClient();
  const q = (query ?? "").trim();

  // Sin query: devolver Consumidor Final + últimos 9
  if (!q) {
    const { data } = await supabase
      .from("business_partners")
      .select("id, full_name, document_type, document_number, phone")
      .eq("partner_type", "customer")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(10);
    return { data: (data ?? []) as PickedCustomer[] };
  }

  // Con query: buscar por nombre, documento o teléfono
  const { data } = await supabase
    .from("business_partners")
    .select("id, full_name, document_type, document_number, phone")
    .eq("partner_type", "customer")
    .eq("is_active", true)
    .or(
      `full_name.ilike.%${q}%,document_number.ilike.%${q}%,phone.ilike.%${q}%`
    )
    .order("full_name")
    .limit(10);

  return { data: (data ?? []) as PickedCustomer[] };
}
