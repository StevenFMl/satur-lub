"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";

// ── Types ──────────────────────────────────────────────────────────────────

export type PickedVehicle = {
  id:    string;
  plate: string;
  make:  string | null;
  model: string | null;
  year:  number | null;
};

export type QuickVehicleResult =
  | { data: PickedVehicle }
  | { error: string; field?: "plate" | "make" | "model" | "year" };

// ── Creación rápida desde POS ──────────────────────────────────────────────

/**
 * Crea un vehículo nuevo para un cliente desde el POS.
 * La placa es única por tenant (UNIQUE constraint).
 * El vehículo queda asociado al partner_id indicado.
 */
export async function createQuickVehicleAction(input: {
  partner_id: string;
  plate:      string;
  make?:      string | null;
  model?:     string | null;
  year?:      number | null;
  notes?:     string | null;
}): Promise<QuickVehicleResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  const plate = (input.plate ?? "").trim().toUpperCase();
  if (plate.length < 4) {
    return { error: "Placa requerida (mínimo 4 caracteres).", field: "plate" };
  }
  if (plate.length > 10) {
    return { error: "Placa inválida (máximo 10 caracteres).", field: "plate" };
  }
  if (!input.partner_id) {
    return { error: "Selecciona un cliente antes de registrar el vehículo." };
  }

  const supabase = await createClient();

  // Verify partner belongs to this tenant (prevents cross-tenant injection)
  const { data: partner } = await supabase
    .from("business_partners")
    .select("id")
    .eq("id", input.partner_id)
    .eq("tenant_id", membership.tenant_id)
    .eq("is_active", true)
    .maybeSingle();

  if (!partner) {
    return { error: "Cliente no encontrado o inactivo." };
  }

  const { data: row, error } = await supabase
    .from("vehicles")
    .insert({
      tenant_id:  membership.tenant_id,
      partner_id: input.partner_id,
      plate,
      make:      input.make?.trim()  || null,
      model:     input.model?.trim() || null,
      year:      input.year          ?? null,
      notes:     input.notes?.trim() || null,
      is_active: true,
    })
    .select("id, plate, make, model, year")
    .single();

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("duplicate") || m.includes("unique")) {
      return { error: "Ya existe un vehículo con esa placa en este tenant.", field: "plate" };
    }
    console.error("createQuickVehicleAction:", error);
    return { error: "No se pudo registrar el vehículo. Intenta de nuevo." };
  }

  return { data: row as PickedVehicle };
}

// ── Lista de vehículos por cliente ─────────────────────────────────────────

/**
 * Devuelve los vehículos activos de un cliente para el POS picker.
 * Limitado a 20 (un cliente de lubricadora raramente tiene más).
 */
export async function listVehiclesByCustomerAction(
  partnerId: string,
): Promise<{ data: PickedVehicle[]; error?: string }> {
  if (!partnerId) return { data: [] };

  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { data: [], error: "Sesión expirada." };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vehicles")
    .select("id, plate, make, model, year")
    .eq("tenant_id", membership.tenant_id)
    .eq("partner_id", partnerId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("listVehiclesByCustomerAction:", error);
    return { data: [], error: "No se pudieron cargar los vehículos." };
  }

  return { data: (data ?? []) as PickedVehicle[] };
}
