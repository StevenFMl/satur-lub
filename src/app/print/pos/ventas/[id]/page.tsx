import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { ReceiptRenderer, type ReceiptData } from "./receipt-renderer";

export const dynamic = "force-dynamic";

export default async function PrintSalePage({
  params,
  searchParams,
}: {
  params:       Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const { id }      = await params;
  const sp          = await searchParams;
  const format      = sp.format === "a4" ? "a4" : "ticket";
  const supabase    = await createClient();
  const tenantId    = membership.tenant_id;

  // ── Sale ──────────────────────────────────────────────────────────────────
  const { data: raw, error } = await supabase
    .from("sales")
    .select(`
      id, sale_date, created_at, status, total, subtotal, tax_total,
      discount_total, document_kind, notes,
      cancelled_at, cancellation_reason,
      business_partners!customer_id (
        full_name, document_type, document_number, phone
      ),
      warehouses!warehouse_id ( name ),
      sale_payments ( payment_method, amount, reference ),
      sale_items (
        id, quantity, unit_price, discount_amount, tax_rate,
        line_total, is_taxable, base_qty,
        price_override_type,
        products!product_id ( name, sku, unit ),
        product_presentations!presentation_id ( unit_label )
      )
    `)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !raw) notFound();

  // ── Returns ───────────────────────────────────────────────────────────────
  const { data: returnsRaw } = await supabase
    .from("sale_returns")
    .select(`
      id, return_type, reason, refund_amount, refund_method,
      processed_at, exchange_sale_id,
      exchange_credit_applied, exchange_credit_refunded
    `)
    .eq("original_sale_id", id)
    .eq("tenant_id", tenantId)
    .order("processed_at", { ascending: true });

  // ── Tenant info ───────────────────────────────────────────────────────────
  // Defensive: select all columns, use what's available
  const { data: tenantRaw } = await supabase
    .from("tenants")
    .select("name, business_name, ruc, tax_id, address, phone, email, logo_url")
    .eq("id", tenantId)
    .maybeSingle();

  const t = tenantRaw as Record<string, string | null> | null;

  // ── Build typed receipt data ───────────────────────────────────────────────
  const sale    = raw as any;
  const items   = ((sale.sale_items   as any[]) ?? []);
  const pmts    = ((sale.sale_payments as any[]) ?? []);
  const returns = (returnsRaw ?? []) as any[];

  const data: ReceiptData = {
    id:             sale.id as string,
    sale_date:      sale.sale_date as string,
    created_at:     sale.created_at as string,
    document_kind:  sale.document_kind as string,
    status:         sale.status as string,
    total:          Number(sale.total          ?? 0),
    subtotal:       Number(sale.subtotal        ?? 0),
    tax_total:      Number(sale.tax_total       ?? 0),
    discount_total: Number(sale.discount_total  ?? 0),
    notes:          sale.notes as string | null,
    cancelled_at:        sale.cancelled_at as string | null,
    cancellation_reason: sale.cancellation_reason as string | null,
    customer: sale.business_partners
      ? {
          full_name:       (sale.business_partners as any).full_name as string,
          document_type:   (sale.business_partners as any).document_type as string,
          document_number: (sale.business_partners as any).document_number as string,
          phone:           (sale.business_partners as any).phone as string | null,
        }
      : null,
    warehouse: sale.warehouses
      ? { name: (sale.warehouses as any).name as string }
      : null,
    items: items.map((si) => ({
      id:                 si.id as string,
      product_name:       (si.products as any)?.name ?? (si.item_name ?? "—"),
      product_sku:        (si.products as any)?.sku  ?? "",
      quantity:           Number(si.quantity      ?? 0),
      unit_price:         Number(si.unit_price    ?? 0),
      line_total:         Number(si.line_total    ?? 0),
      discount_amount:    Number(si.discount_amount ?? 0),
      is_taxable:         Boolean(si.is_taxable),
      tax_rate:           Number(si.tax_rate ?? 15),
      base_qty:           Number(si.base_qty  ?? 1),
      presentation_label: (si.product_presentations as any)?.unit_label ?? null,
      price_override_type: si.price_override_type as string | null,
    })),
    payments: pmts.map((p) => ({
      payment_method: p.payment_method as string,
      amount:         Number(p.amount ?? 0),
      reference:      p.reference as string | null,
    })),
    returns: returns.map((r) => ({
      id:                      r.id as string,
      return_type:             r.return_type as string,
      reason:                  r.reason as string,
      refund_amount:           Number(r.refund_amount ?? 0),
      refund_method:           r.refund_method as string | null,
      processed_at:            r.processed_at as string,
      exchange_sale_id:        r.exchange_sale_id as string | null,
      exchange_credit_applied:  Number(r.exchange_credit_applied  ?? 0),
      exchange_credit_refunded: Number(r.exchange_credit_refunded ?? 0),
    })),
    tenant: {
      name:    t?.business_name ?? t?.name ?? "Mi Negocio",
      ruc:     t?.ruc ?? t?.tax_id ?? null,
      address: t?.address ?? null,
      phone:   t?.phone   ?? null,
      email:   t?.email   ?? null,
    },
  };

  return <ReceiptRenderer data={data} format={format} saleId={id} />;
}
