"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { saleSchema, type SaleInput } from "@/lib/validations/sale";

export type CreateSaleResult = {
  ok?: boolean;
  saleId?: string;
  error?: string;
} | null;

export type VoidSaleResult = {
  ok?: boolean;
  error?: string;
} | null;

export async function createSaleAction(
  input: SaleInput
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
    p_tenant_id:     membership.tenant_id,
    p_customer_id:   data.customer_id,
    p_warehouse_id:  data.warehouse_id,
    p_items:         data.items as never,
    p_payments:      data.payments as never,
    p_notes:         data.notes ?? null,
    p_document_kind: data.document_kind,
    p_sale_date:     data.sale_date ?? null,
  } as never);

  if (error) {
    console.error("createSaleAction RPC error:", error);
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
      msg.startsWith("Descuento máximo")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo registrar la venta. Intenta de nuevo." };
  }

  revalidateTag("products");
  revalidatePath("/dashboard/pos");
  revalidatePath("/dashboard/pos/ventas");
  revalidatePath("/dashboard/inventario/stock");
  revalidatePath("/dashboard/inventario/movimientos");

  return { ok: true, saleId: typeof saleId === "string" ? saleId : undefined };
}

export async function voidSaleAction(input: {
  sale_id: string;
  reason:  string;
  note?:   string | null;
}): Promise<VoidSaleResult> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (!input.sale_id) return { error: "ID de venta requerido." };
  if (!input.reason?.trim()) return { error: "El motivo es requerido." };

  const supabase = await createClient();

  const { error } = await supabase.rpc("void_sale", {
    p_tenant_id: membership.tenant_id,
    p_sale_id:   input.sale_id,
    p_reason:    input.reason.trim(),
    p_note:      input.note ?? null,
  } as never);

  if (error) {
    console.error("voidSaleAction RPC error:", error);
    const msg = error.message ?? "";
    if (
      msg.startsWith("No autenticado") ||
      msg.startsWith("Sin acceso") ||
      msg.startsWith("Sin permisos") ||
      msg.startsWith("Se requiere un motivo") ||
      msg.startsWith("Venta no encontrada") ||
      msg.startsWith("La venta ya está") ||
      msg.startsWith("Solo se pueden anular")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo anular la venta. Intenta de nuevo." };
  }

  revalidatePath("/dashboard/pos/ventas");
  revalidatePath(`/dashboard/pos/ventas/${input.sale_id}`);
  revalidatePath("/dashboard/pos/cierre");
  revalidatePath("/dashboard/inventario/stock");
  revalidatePath("/dashboard/inventario/movimientos");

  return { ok: true };
}
