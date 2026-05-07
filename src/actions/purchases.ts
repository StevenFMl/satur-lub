"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import {
  purchaseSchema,
  type PurchaseFieldErrors,
} from "@/lib/validations/purchase";
import {
  grandTotal,
  sumAll,
  taxAmount,
  toFixedStr,
  lineTotal,
} from "@/lib/math";

export type PurchaseState = {
  ok?: boolean;
  poId?: string;
  error?: string;
  fieldErrors?: PurchaseFieldErrors;
} | null;

export async function receivePurchaseAction(
  _prev: PurchaseState,
  formData: FormData
): Promise<PurchaseState> {
  // Los ítems vienen como JSON string en un input hidden — el client form
  // los serializa para evitar parsear nombres tipo `items[0][product_id]`.
  const itemsRaw = formData.get("items_json");
  let items: unknown = [];
  try {
    items = JSON.parse(typeof itemsRaw === "string" ? itemsRaw : "[]");
  } catch {
    return { error: "Ítems con formato inválido." };
  }

  const parsed = purchaseSchema.safeParse({
    supplier_id: formData.get("supplier_id"),
    warehouse_id: formData.get("warehouse_id"),
    payment_method: formData.get("payment_method"),
    payment_due_date: formData.get("payment_due_date"),
    notes: formData.get("notes"),
    items,
    tax_rate: formData.get("tax_rate"),
    subtotal: formData.get("subtotal"),
    tax_amount: formData.get("tax_amount"),
    grand_total: formData.get("grand_total"),
  });

  if (!parsed.success) {
    const fieldErrors: PurchaseFieldErrors = {};
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

  const supabase = await createClient();

  const payment_status =
    data.payment_method === "credit" ? "pending" : "paid";

  // ── Recalcular totales server-side con big.js (NO confiar en el cliente).
  //    El cliente envía los valores para UX, pero la fuente de verdad fiscal
  //    se deriva aquí a partir de los ítems ya validados por Zod.
  const serverSubtotal = sumAll(
    data.items.map((i) => lineTotal(i.quantity, i.unit_cost))
  );
  const serverTax = taxAmount(serverSubtotal, data.tax_rate);
  const serverGrand = grandTotal(serverSubtotal, serverTax);

  // RPC SECURITY INVOKER + transacción atómica:
  // INSERT purchase_orders → INSERT purchase_order_items → INSERT inventory_movements
  // → UPSERT inventory_balances. Cualquier excepción aborta TODO.
  const { data: poId, error } = await supabase.rpc(
    "receive_purchase_order",
    {
      p_supplier_id: data.supplier_id,
      p_warehouse_id: data.warehouse_id,
      p_payment_method: data.payment_method,
      p_payment_status: payment_status,
      p_payment_due_date: data.payment_due_date,
      p_notes: data.notes,
      p_items: data.items,
      p_tax_rate: data.tax_rate,
      p_subtotal: toFixedStr(serverSubtotal, 2),
      p_tax_amount: toFixedStr(serverTax, 2),
      p_grand_total: toFixedStr(serverGrand, 2),
    } as never
  );

  if (error) {
    console.error("receive_purchase_order:", error);
    // Mensajes funcionales de la RPC son seguros para mostrar (no exponen schema).
    const msg = error.message ?? "";
    if (
      msg.startsWith("Proveedor") ||
      msg.startsWith("Bodega") ||
      msg.startsWith("Producto") ||
      msg.startsWith("Cantidad") ||
      msg.startsWith("Método") ||
      msg.startsWith("Debe") ||
      msg.startsWith("Sin tenant") ||
      msg.startsWith("Usuario")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo registrar la compra." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/compras");
  revalidatePath("/dashboard/inventario");
  return {
    ok: true,
    poId: typeof poId === "string" ? poId : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Anulación de Orden de Compra                                       */
/* ------------------------------------------------------------------ */

export type CancelState = {
  ok?: boolean;
  error?: string;
} | null;

export async function cancelPurchaseAction(
  poId: string
): Promise<CancelState> {
  const { user, membership } = await getActiveMembership();
  if (!user || !membership) return { error: "Sesión expirada." };

  if (membership.role !== "owner" && membership.role !== "admin") {
    return { error: "No tienes permisos para anular compras." };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("cancel_purchase_order", {
    p_po_id: poId,
  } as never);

  if (error) {
    console.error("cancel_purchase_order:", error);
    const msg = error.message ?? "";
    if (
      msg.startsWith("Orden") ||
      msg.startsWith("Solo") ||
      msg.startsWith("Sin tenant") ||
      msg.startsWith("Usuario")
    ) {
      return { error: msg };
    }
    return { error: "No se pudo anular la compra." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/compras");
  revalidatePath("/dashboard/inventario");
  return { ok: true };
}
