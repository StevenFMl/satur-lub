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

/**
 * Creates a complete sale atomically via the `create_sale` RPC.
 *
 * All members can sell (canUsePOS = true for all roles).
 * Price re-read, stock validation, inventory movements, and CPP updates
 * all happen server-side inside the SECURITY DEFINER RPC.
 */
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
  revalidatePath("/dashboard/inventario/stock");
  revalidatePath("/dashboard/inventario/movimientos");

  return { ok: true, saleId: typeof saleId === "string" ? saleId : undefined };
}
