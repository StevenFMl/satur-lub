"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  convertInventorySchema,
  type ConvertInventoryInput,
} from "@/lib/validations/inventory-conversion";

export type ConvertInventoryResult =
  | { ok: true;  conversionId: string }
  | { ok: false; error: string };

export async function convertInventoryAction(
  input: ConvertInventoryInput
): Promise<ConvertInventoryResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { ok: false, error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { ok: false, error: "Sin permisos para convertir inventario." };
  }

  const parsed = convertInventorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const d = parsed.data;
  const supabase = await createClient();

  const { data: conversionId, error } = await supabase.rpc("convert_inventory", {
    p_tenant_id:          membership.tenant_id,
    p_warehouse_id:       d.warehouse_id,
    p_source_product_id:  d.source_product_id,
    p_dest_product_id:    d.dest_product_id,
    p_source_qty:         d.source_qty,
    p_dest_qty:           d.dest_qty,
    p_notes:              d.notes ?? null,
  } as never);

  if (error) {
    console.error("convertInventoryAction RPC error:", error.message, error.code);
    const msg = error.message ?? "";
    if (
      msg.startsWith("No autenticado") ||
      msg.startsWith("Sin acceso") ||
      msg.startsWith("Sin permisos") ||
      msg.startsWith("Stock insuficiente") ||
      msg.startsWith("No existe una regla") ||
      msg.startsWith("Cantidad destino inválida") ||
      msg.startsWith("La cantidad") ||
      msg.startsWith("El producto") ||
      msg.startsWith("Producto") ||
      msg.startsWith("Bodega")
    ) {
      return { ok: false, error: msg };
    }
    return { ok: false, error: "No se pudo registrar la conversión. Intenta de nuevo." };
  }

  revalidatePath("/dashboard/inventario/stock");
  revalidatePath("/dashboard/inventario/movimientos");
  revalidatePath("/dashboard/inventario/conversiones");

  return { ok: true, conversionId: conversionId as string };
}
