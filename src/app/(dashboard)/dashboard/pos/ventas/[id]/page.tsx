import type { Metadata }   from "next";
import { redirect, notFound } from "next/navigation";
import { createClient }     from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { getPosPermissions } from "@/lib/auth/permissions";
import { SaleDetail }        from "./sale-detail";
import type { ElectronicInvoiceRecord } from "@/lib/sri/types";

export const metadata: Metadata = { title: "Detalle de Venta · SaturLub" };
export const dynamic = "force-dynamic";

// ── Types (exported — used by sale-detail.tsx and sub-components) ──────────

export type SaleReturnItemData = {
  sale_item_id:      string;
  quantity_returned: number;
  unit_price:        number;
  line_refund:       number;
  restock:           boolean;
};

export type SaleReturnData = {
  id:                      string;
  return_type:             string;
  reason:                  string;
  notes:                   string | null;
  refund_amount:           number;
  refund_method:           string | null;
  refund_reference:        string | null;
  processed_at:            string;
  exchange_sale_id:        string | null;
  exchange_credit_applied:  number;
  exchange_credit_refunded: number;
  items:                   SaleReturnItemData[];
};

export type SaleDetailItem = {
  id:                    string;
  quantity:              number;
  unit_price:            number;
  discount_amount:       number;
  tax_rate:              number;
  line_total:            number;
  is_taxable:            boolean;
  base_qty:              number;
  original_unit_price:   number | null;
  price_override_type:   string | null;
  price_override_reason: string | null;
  price_override_at:     string | null;
  product_name:          string;
  product_sku:           string;
  product_unit:          string;
  presentation_label:    string | null;
  // Computed from returns
  already_returned:      number;
  available_to_return:   number;
};

export type SaleDetailData = {
  id:                  string;
  sale_date:           string;
  created_at:          string;
  status:              string;
  total:               number;
  subtotal:            number;
  tax_total:           number;
  discount_total:      number;
  document_kind:       string;
  notes:               string | null;
  cancelled_at:        string | null;
  cancelled_by:        string | null;
  cancellation_reason: string | null;
  cancellation_note:   string | null;
  customer: {
    full_name:       string;
    document_type:   string;
    document_number: string;
    phone:           string | null;
  } | null;
  warehouse: { name: string } | null;
  payments: {
    id:             string;
    payment_method: string;
    amount:         number;
    reference:      string | null;
  }[];
  items:        SaleDetailItem[];
  returns:      SaleReturnData[];
  returnStatus: "none" | "partial" | "full";
};

// ── Page ───────────────────────────────────────────────────────────────────

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const permissions = getPosPermissions(membership.role);
  if (!permissions.canUsePOS) redirect("/dashboard");

  const { id }    = await params;
  const supabase  = await createClient();
  const tenantId  = membership.tenant_id;

  // ── 1. Sale (flat — no embedded joins) ────────────────────────────────────
  //
  // The previous version used a single SELECT with deeply nested PostgREST
  // joins (products!product_id, product_presentations!presentation_id, etc.).
  // Any FK not in PostgREST's schema cache returns PGRST200, and the old
  // `if (error || !raw) notFound()` silently converted that into a false 404.
  //
  // Fix: keep every query flat; join nothing via PostgREST; assemble in TS.

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .select(`
      id, sale_date, created_at, status, total, subtotal, tax_total,
      discount_total, document_kind, notes, warehouse_id,
      cancelled_at, cancelled_by, cancellation_reason, cancellation_note,
      customer_id
    `)
    .eq("id",        id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (saleErr) {
    console.error(`[sale-detail] sales query failed — id=${id} tenant=${tenantId}:`,
      saleErr.code, saleErr.message);
    // Not a genuine 404 — DB/schema error.  Treat same as not-found for now
    // (a proper error screen could be added here later).
    notFound();
  }
  if (!sale) {
    // Genuine: sale doesn't exist or doesn't belong to this tenant.
    notFound();
  }

  const s = sale as Record<string, unknown>;

  // ── 2. Parallel: items · payments · returns · invoice ─────────────────────

  const [itemsRes, paymentsRes, returnsRes, invoiceRes, cashSessionRes] =
    await Promise.all([
      // sale_items — flat, no nested product join
      supabase
        .from("sale_items")
        .select(`
          id, quantity, unit_price, discount_amount, tax_rate, line_total,
          is_taxable, base_qty, product_id, presentation_id,
          original_unit_price, price_override_type, price_override_reason, price_override_at
        `)
        .eq("sale_id", id),

      // payments
      supabase
        .from("sale_payments")
        .select("id, payment_method, amount, reference")
        .eq("sale_id", id),

      // returns (with their items)
      supabase
        .from("sale_returns")
        .select(`
          id, return_type, reason, notes, refund_amount, refund_method,
          refund_reference, processed_at, exchange_sale_id,
          exchange_credit_applied, exchange_credit_refunded,
          sale_return_items(sale_item_id, quantity_returned, unit_price, line_refund, restock)
        `)
        .eq("original_sale_id", id)
        .eq("tenant_id",        tenantId)
        .order("processed_at", { ascending: true }),

      // electronic invoice (optional — missing invoice must NOT cause 404)
      supabase
        .from("electronic_invoices")
        .select("*")
        .eq("sale_id",   id)
        .eq("doc_type",  "01")
        .eq("tenant_id", tenantId)
        .maybeSingle(),

      // open cash session for this sale's warehouse (used by ReturnDialog)
      (() => {
        const wid = s.warehouse_id as string | null;
        let q = supabase
          .from("cash_sessions")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("status",    "open");
        return wid ? q.eq("warehouse_id", wid) : q.is("warehouse_id", null);
      })().maybeSingle(),
    ]);

  // Log secondary failures — don't 404, degrade gracefully
  if (itemsRes.error) {
    console.error(`[sale-detail] sale_items failed — sale=${id}:`,
      itemsRes.error.code, itemsRes.error.message);
  }
  if (invoiceRes.error) {
    console.error(`[sale-detail] electronic_invoices failed — sale=${id}:`,
      invoiceRes.error.code, invoiceRes.error.message);
  }

  const rawItems    = (itemsRes.data    ?? []) as any[];
  const rawPayments = (paymentsRes.data ?? []) as any[];
  const rawReturns  = (returnsRes.data  ?? []) as any[];
  const cashSessionId = (cashSessionRes.data as any)?.id as string | null ?? null;

  // ── 3. Look up products + presentations (only IDs that appear) ───────────

  const productIds      = [...new Set(rawItems.map((i) => i.product_id     as string).filter(Boolean))];
  const presentationIds = [...new Set(rawItems.map((i) => i.presentation_id as string).filter(Boolean))];
  const customerId      = s.customer_id as string | null;
  const warehouseId     = s.warehouse_id as string | null;

  const [productsRes, presRes, customerRes, warehouseRes] = await Promise.all([
    productIds.length > 0
      ? supabase
          .from("products")
          .select("id, name, sku, unit")
          .in("id", productIds)
      : (Promise.resolve({ data: [], error: null }) as any),

    presentationIds.length > 0
      ? supabase
          .from("product_presentations")
          .select("id, unit_label")
          .in("id", presentationIds)
      : (Promise.resolve({ data: [], error: null }) as any),

    customerId
      ? supabase
          .from("business_partners")
          .select("full_name, document_type, document_number, phone")
          .eq("id", customerId)
          .maybeSingle()
      : (Promise.resolve({ data: null, error: null }) as any),

    warehouseId
      ? supabase
          .from("warehouses")
          .select("name")
          .eq("id", warehouseId)
          .maybeSingle()
      : (Promise.resolve({ data: null, error: null }) as any),
  ]);

  // ── 4. Build lookup maps ───────────────────────────────────────────────────

  const productMap = new Map<string, { name: string; sku: string; unit: string }>(
    ((productsRes.data ?? []) as any[]).map((p: any) => [
      p.id as string,
      { name: p.name as string, sku: p.sku as string, unit: p.unit as string },
    ]),
  );

  const presMap = new Map<string, string>(
    ((presRes.data ?? []) as any[]).map((p: any) => [
      p.id as string, p.unit_label as string,
    ]),
  );

  const customerRow = customerRes.data as {
    full_name: string; document_type: string; document_number: string; phone: string | null;
  } | null;

  const warehouseRow = warehouseRes.data as { name: string } | null;

  // ── 5. Build returned-qty map ──────────────────────────────────────────────

  const returnedQtyByItem: Record<string, number> = {};
  for (const r of rawReturns) {
    for (const ri of (r.sale_return_items as any[]) ?? []) {
      const key = ri.sale_item_id as string;
      returnedQtyByItem[key] = (returnedQtyByItem[key] ?? 0) + Number(ri.quantity_returned ?? 0);
    }
  }

  // ── 6. Normalize items ────────────────────────────────────────────────────

  const items: SaleDetailItem[] = rawItems.map((si) => {
    const product      = si.product_id      ? productMap.get(si.product_id as string)      : undefined;
    const presLabel    = si.presentation_id  ? presMap.get(si.presentation_id as string)    : undefined;
    const qty          = Number(si.quantity ?? 0);
    const alreadyRet   = returnedQtyByItem[si.id as string] ?? 0;
    return {
      id:                    si.id as string,
      quantity:              qty,
      unit_price:            Number(si.unit_price       ?? 0),
      discount_amount:       Number(si.discount_amount  ?? 0),
      tax_rate:              Number(si.tax_rate         ?? 0),
      line_total:            Number(si.line_total       ?? 0),
      is_taxable:            Boolean(si.is_taxable),
      base_qty:              Number(si.base_qty         ?? 1),
      original_unit_price:   si.original_unit_price != null ? Number(si.original_unit_price) : null,
      price_override_type:   (si.price_override_type   as string | null) ?? null,
      price_override_reason: (si.price_override_reason as string | null) ?? null,
      price_override_at:     (si.price_override_at     as string | null) ?? null,
      product_name:          product?.name ?? "—",
      product_sku:           product?.sku  ?? "",
      product_unit:          product?.unit ?? "",
      presentation_label:    presLabel ?? null,
      already_returned:      alreadyRet,
      available_to_return:   Math.max(0, qty - alreadyRet),
    };
  });

  // ── 7. Normalize returns ──────────────────────────────────────────────────

  const returns: SaleReturnData[] = rawReturns.map((r: any) => ({
    id:               r.id as string,
    return_type:      r.return_type as string,
    reason:           r.reason as string,
    notes:            (r.notes as string | null) ?? null,
    refund_amount:    Number(r.refund_amount ?? 0),
    refund_method:    (r.refund_method    as string | null) ?? null,
    refund_reference: (r.refund_reference as string | null) ?? null,
    processed_at:             r.processed_at as string,
    exchange_sale_id:         (r.exchange_sale_id as string | null) ?? null,
    exchange_credit_applied:  Number(r.exchange_credit_applied  ?? 0),
    exchange_credit_refunded: Number(r.exchange_credit_refunded ?? 0),
    items: ((r.sale_return_items as any[]) ?? []).map((ri) => ({
      sale_item_id:      ri.sale_item_id as string,
      quantity_returned: Number(ri.quantity_returned ?? 0),
      unit_price:        Number(ri.unit_price        ?? 0),
      line_refund:       Number(ri.line_refund        ?? 0),
      restock:           Boolean(ri.restock ?? true),
    })),
  }));

  // ── 8. Compute visual return status ──────────────────────────────────────

  let returnStatus: SaleDetailData["returnStatus"] = "none";
  if (returns.length > 0) {
    const totalSoldQty    = items.reduce((s, i) => s + i.quantity, 0);
    const totalReturnedQty = items.reduce((s, i) => s + i.already_returned, 0);
    returnStatus = totalReturnedQty >= totalSoldQty ? "full" : "partial";
  }

  // ── 9. Assemble SaleDetailData ────────────────────────────────────────────

  const saleData: SaleDetailData = {
    id:                  s.id as string,
    sale_date:           s.sale_date as string,
    created_at:          s.created_at as string,
    status:              s.status as string,
    total:               Number(s.total          ?? 0),
    subtotal:            Number(s.subtotal        ?? 0),
    tax_total:           Number(s.tax_total       ?? 0),
    discount_total:      Number(s.discount_total  ?? 0),
    document_kind:       s.document_kind as string,
    notes:               (s.notes as string | null) ?? null,
    cancelled_at:        (s.cancelled_at        as string | null) ?? null,
    cancelled_by:        (s.cancelled_by        as string | null) ?? null,
    cancellation_reason: (s.cancellation_reason as string | null) ?? null,
    cancellation_note:   (s.cancellation_note   as string | null) ?? null,
    customer: customerRow
      ? {
          full_name:       customerRow.full_name,
          document_type:   customerRow.document_type,
          document_number: customerRow.document_number,
          phone:           customerRow.phone,
        }
      : null,
    warehouse: warehouseRow ? { name: warehouseRow.name } : null,
    payments: rawPayments.map((p) => ({
      id:             p.id as string,
      payment_method: p.payment_method as string,
      amount:         Number(p.amount   ?? 0),
      reference:      (p.reference as string | null) ?? null,
    })),
    items,
    returns,
    returnStatus,
  };

  // electronic_invoice is optional — null is fine; InvoiceCard handles both states
  const invoice = (invoiceRes.data as ElectronicInvoiceRecord | null) ?? null;
  const canEmitInvoice = membership.role === "owner" || membership.role === "admin";

  return (
    <SaleDetail
      sale={saleData}
      canVoidSale={permissions.canVoidSale}
      canProcessReturn={permissions.canProcessReturn}
      canSetNoRestock={permissions.canSetNoRestock}
      cashSessionId={cashSessionId}
      invoice={invoice}
      canEmitInvoice={canEmitInvoice}
    />
  );
}
