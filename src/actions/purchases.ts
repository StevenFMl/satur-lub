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

  // ── 1. Creación Inline de Productos Nuevos ──
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item.is_new_product && item.new_product_name) {
      // El usuario pidió: costo base neto sin IVA dividiendo el unitario ingresado para 1.15
      const netBaseCost = Number((item.unit_cost / 1.15).toFixed(4));
      
      // Generar un SKU determinista simple para el nuevo producto
      const shortName = item.new_product_name.replace(/[^a-zA-Z0-9]/g, "").substring(0, 4).toUpperCase();
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const sku = `${shortName}-${randomSuffix}`;
      
      const payload = {
        tenant_id: membership.tenant_id,
        name: item.new_product_name,
        sku: sku,
        unit: "galón", // Unidad por defecto según el requerimiento
        cost_price: netBaseCost,
        product_kind: "item"
      };

      const { data: inserted, error: insertError } = await supabase
        .from("products")
        .insert(payload)
        .select("id")
        .single();

      if (insertError || !inserted) {
        console.error("Error creando producto inline:", insertError);
        return { error: `No se pudo crear el producto nuevo: ${item.new_product_name}` };
      }
      
      item.product_id = inserted.id;
    }
  }

  // ── Recalcular totales server-side con big.js (NO confiar en el cliente).
  //    Obtenemos el tax_rate de cada producto desde la Base de Datos para
  //    calcular el IVA de forma granular.
  const productIds = data.items.map(i => i.product_id).filter(Boolean) as string[];
  const { data: dbProducts } = await supabase
    .from("products")
    .select("id, tax_rate")
    .in("id", productIds);
    
  const dbProductMap = new Map(dbProducts?.map(p => [p.id, p.tax_rate ?? 15]) || []);

  let serverTaxBig = Big(0);
  const serverSubtotal = sumAll(
    data.items.map((i) => {
      const lineT = lineTotal(i.quantity, i.unit_cost);
      const pRate = dbProductMap.get(i.product_id as string) || 15;
      if (pRate > 0) {
        serverTaxBig = serverTaxBig.plus(taxAmount(lineT, pRate));
      }
      return lineT;
    })
  );
  
  const serverTax = toMoney(serverTaxBig);
  const serverGrand = add(grandTotal(serverSubtotal, serverTax), data.other_charges);

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
      p_items: data.items.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_cost: item.unit_cost
      })),
      p_tax_rate: 15, // Legacy field in RPC, can just pass 15. Real tax is handled implicitly by totals.
      p_subtotal: toFixedStr(serverSubtotal, 2),
      p_tax_amount: toFixedStr(serverTax, 2),
      p_grand_total: toFixedStr(serverGrand, 2),
      p_other_charges: toFixedStr(data.other_charges, 2),
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
