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
  add,
  toMoney,
} from "@/lib/math";
import Big from "big.js";

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
    is_tax_inclusive: formData.get("is_tax_inclusive"),
    subtotal: formData.get("subtotal"),
    tax_amount: formData.get("tax_amount"),
    other_charges: formData.get("other_charges"),
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

  // ── No inline creation needed here anymore, QuickCreateProductDialog handles it.

  // ── Recalcular totales server-side con big.js (NO confiar en el cliente).
  //    Obtenemos el has_tax de cada producto desde la Base de Datos para
  //    calcular el IVA de forma granular usando el tax_rate.
  const invoiceTaxRate = data.tax_rate ?? 15;
  const isTaxInclusive = data.is_tax_inclusive;
  const taxRateBig = Big(invoiceTaxRate).div(100);

  const productIds = data.items.map(i => i.product_id).filter(Boolean) as string[];
  const { data: dbProducts } = await supabase
    .from("products")
    .select("id, has_tax")
    .in("id", productIds);
    
  const dbProductMap = new Map(dbProducts?.map(p => [p.id, p.has_tax ?? true]) || []);

  let serverSubtotalBig = Big(0);
  let serverTaxBig = Big(0);

  const p_items = data.items.map((item) => {
    const isTaxable = dbProductMap.get(item.product_id as string) ?? true;
    
    // item.unit_cost received from client is GROSS if isTaxInclusive is true
    let unitCostBig = Big(item.unit_cost);
    
    if (isTaxInclusive && isTaxable && invoiceTaxRate > 0) {
      unitCostBig = unitCostBig.div(Big(1).plus(taxRateBig));
    }
    
    // Preserve sufficient precision for inventory (4 decimals)
    const netUnitCostStr = toFixedStr(unitCostBig, 4);
    const netUnitCostBig = Big(netUnitCostStr);
    const qtyBig = Big(item.quantity);
    
    // Server recalculates line total based on net cost (rounds to 2 decimals)
    const lineTotalBig = toMoney(netUnitCostBig.times(qtyBig));
    serverSubtotalBig = serverSubtotalBig.plus(lineTotalBig);
    
    if (isTaxable && invoiceTaxRate > 0) {
      serverTaxBig = serverTaxBig.plus(taxAmount(lineTotalBig, invoiceTaxRate));
    }
    
    return {
      product_id: item.product_id,
      quantity: Number(item.quantity),
      unit_cost: Number(netUnitCostStr),
      is_taxable: isTaxable
    };
  });

  const serverSubtotalStr = toFixedStr(serverSubtotalBig, 2);
  const serverTaxStr = toFixedStr(serverTaxBig, 2);
  const serverGrandBig = Big(serverSubtotalStr).plus(Big(serverTaxStr)).plus(Big(data.other_charges || 0));
  const serverGrandStr = toFixedStr(serverGrandBig, 2);

  // RPC SECURITY INVOKER + transacción atómica
  const { data: poId, error } = await supabase.rpc(
    "receive_purchase_order",
    {
      p_tenant_id: membership.tenant_id,
      p_supplier_id: data.supplier_id,
      p_warehouse_id: data.warehouse_id,
      p_payment_method: data.payment_method,
      p_payment_status: payment_status,
      p_payment_due_date: data.payment_due_date,
      p_notes: data.notes,
      p_items: p_items,
      p_tax_rate: invoiceTaxRate,
      p_is_tax_inclusive: isTaxInclusive,
      p_subtotal: Number(serverSubtotalStr),
      p_tax_amount: Number(serverTaxStr),
      p_grand_total: Number(serverGrandStr),
      p_other_charges: Number(toFixedStr(data.other_charges, 2)),
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
    p_tenant_id: membership.tenant_id,
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
