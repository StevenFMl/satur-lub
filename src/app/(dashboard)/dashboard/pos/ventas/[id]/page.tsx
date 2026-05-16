import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { getPosPermissions } from "@/lib/auth/permissions";
import { SaleDetail } from "./sale-detail";

export const metadata: Metadata = { title: "Detalle de Venta · SaturLub" };
export const dynamic = "force-dynamic";

// ── Types ──────────────────────────────────────────────────────────────────

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
  items:   SaleDetailItem[];
  returns: SaleReturnData[];
  // Derived visual state
  returnStatus: "none" | "partial" | "full";
};

// ── Page ───────────────────────────────────────────────────────────────────

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const permissions = getPosPermissions(membership.role);
  if (!permissions.canUsePOS) redirect("/dashboard");

  const { id } = await params;
  const supabase = await createClient();

  // Fetch sale + relations (warehouse_id used locally for cash session lookup)
  const { data: raw, error } = await supabase
    .from("sales")
    .select(
      `id, sale_date, created_at, status, total, subtotal, tax_total,
       discount_total, document_kind, notes, warehouse_id,
       cancelled_at, cancelled_by, cancellation_reason, cancellation_note,
       business_partners!customer_id(full_name, document_type, document_number, phone),
       warehouses!warehouse_id(name),
       sale_payments(id, payment_method, amount, reference),
       sale_items(
         id, quantity, unit_price, discount_amount, tax_rate, line_total,
         is_taxable, base_qty,
         original_unit_price, price_override_type, price_override_reason, price_override_at,
         products!product_id(name, sku, unit),
         product_presentations!presentation_id(unit_label)
       )`
    )
    .eq("id", id)
    .eq("tenant_id", membership.tenant_id)
    .single();

  if (error || !raw) notFound();

  // Find the open cash session that matches this sale's warehouse.
  // Used by ReturnDialog so cash refunds are recorded in caja automatically.
  const saleWarehouseId = raw.warehouse_id as string | null;
  let cashSessionId: string | null = null;
  {
    let sessionQ = supabase
      .from("cash_sessions")
      .select("id")
      .eq("tenant_id", membership.tenant_id)
      .eq("status", "open");

    if (saleWarehouseId) {
      sessionQ = sessionQ.eq("warehouse_id", saleWarehouseId);
    } else {
      sessionQ = sessionQ.is("warehouse_id", null);
    }

    const { data: sessData } = await sessionQ.maybeSingle();
    cashSessionId = (sessData?.id as string | null) ?? null;
  }

  // Fetch returns for this sale
  const { data: returnsRaw } = await supabase
    .from("sale_returns")
    .select(
      `id, return_type, reason, notes, refund_amount, refund_method,
       refund_reference, processed_at, exchange_sale_id,
       exchange_credit_applied, exchange_credit_refunded,
       sale_return_items(sale_item_id, quantity_returned, unit_price, line_refund, restock)`
    )
    .eq("original_sale_id", id)
    .eq("tenant_id", membership.tenant_id)
    .order("processed_at", { ascending: true });

  // Build already_returned map: sale_item_id → total qty returned
  const returnedQtyByItem: Record<string, number> = {};
  for (const r of returnsRaw ?? []) {
    for (const ri of (r.sale_return_items as any[]) ?? []) {
      const key = ri.sale_item_id as string;
      returnedQtyByItem[key] = (returnedQtyByItem[key] ?? 0) + Number(ri.quantity_returned ?? 0);
    }
  }

  // Normalize items with return data
  const items: SaleDetailItem[] = ((raw.sale_items as any[]) ?? []).map((si) => {
    const qty             = Number(si.quantity ?? 0);
    const alreadyReturned = returnedQtyByItem[si.id] ?? 0;
    return {
      id:                    si.id as string,
      quantity:              qty,
      unit_price:            Number(si.unit_price ?? 0),
      discount_amount:       Number(si.discount_amount ?? 0),
      tax_rate:              Number(si.tax_rate ?? 0),
      line_total:            Number(si.line_total ?? 0),
      is_taxable:            Boolean(si.is_taxable),
      base_qty:              Number(si.base_qty ?? 1),
      original_unit_price:   si.original_unit_price != null ? Number(si.original_unit_price) : null,
      price_override_type:   si.price_override_type as string | null,
      price_override_reason: si.price_override_reason as string | null,
      price_override_at:     si.price_override_at as string | null,
      product_name:          (si.products as any)?.name ?? "—",
      product_sku:           (si.products as any)?.sku  ?? "",
      product_unit:          (si.products as any)?.unit ?? "",
      presentation_label:    (si.product_presentations as any)?.unit_label ?? null,
      already_returned:      alreadyReturned,
      available_to_return:   Math.max(0, qty - alreadyReturned),
    };
  });

  // Normalize returns
  const returns: SaleReturnData[] = (returnsRaw ?? []).map((r: any) => ({
    id:               r.id as string,
    return_type:      r.return_type as string,
    reason:           r.reason as string,
    notes:            r.notes as string | null,
    refund_amount:    Number(r.refund_amount ?? 0),
    refund_method:    r.refund_method as string | null,
    refund_reference: r.refund_reference as string | null,
    processed_at:             r.processed_at as string,
    exchange_sale_id:         r.exchange_sale_id as string | null,
    exchange_credit_applied:  Number(r.exchange_credit_applied  ?? 0),
    exchange_credit_refunded: Number(r.exchange_credit_refunded ?? 0),
    items: ((r.sale_return_items as any[]) ?? []).map((ri) => ({
      sale_item_id:      ri.sale_item_id as string,
      quantity_returned: Number(ri.quantity_returned ?? 0),
      unit_price:        Number(ri.unit_price ?? 0),
      line_refund:       Number(ri.line_refund ?? 0),
      restock:           Boolean(ri.restock ?? true),
    })),
  }));

  // Compute visual return status (not persisted to DB)
  let returnStatus: SaleDetailData["returnStatus"] = "none";
  if (returns.length > 0) {
    const totalSoldQty    = items.reduce((s, i) => s + i.quantity, 0);
    const totalReturnedQty = items.reduce((s, i) => s + i.already_returned, 0);
    returnStatus = totalReturnedQty >= totalSoldQty ? "full" : "partial";
  }

  const sale: SaleDetailData = {
    id:                  raw.id as string,
    sale_date:           raw.sale_date as string,
    created_at:          raw.created_at as string,
    status:              raw.status as string,
    total:               Number(raw.total ?? 0),
    subtotal:            Number(raw.subtotal ?? 0),
    tax_total:           Number(raw.tax_total ?? 0),
    discount_total:      Number(raw.discount_total ?? 0),
    document_kind:       raw.document_kind as string,
    notes:               raw.notes as string | null,
    cancelled_at:        raw.cancelled_at as string | null,
    cancelled_by:        raw.cancelled_by as string | null,
    cancellation_reason: raw.cancellation_reason as string | null,
    cancellation_note:   raw.cancellation_note as string | null,
    customer:            raw.business_partners as unknown as SaleDetailData["customer"],
    warehouse:           raw.warehouses as unknown as SaleDetailData["warehouse"],
    payments: ((raw.sale_payments as any[]) ?? []).map((p) => ({
      id:             p.id as string,
      payment_method: p.payment_method as string,
      amount:         Number(p.amount ?? 0),
      reference:      p.reference as string | null,
    })),
    items,
    returns,
    returnStatus,
  };

  return (
    <SaleDetail
      sale={sale}
      canVoidSale={permissions.canVoidSale}
      canProcessReturn={permissions.canProcessReturn}
      canSetNoRestock={permissions.canSetNoRestock}
      cashSessionId={cashSessionId}
    />
  );
}
