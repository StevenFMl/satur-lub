import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { ReceiptRenderer, type ReceiptData } from "./receipt-renderer";
import { PrintError } from "./print-error";

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

  const { id }   = await params;
  const sp       = await searchParams;
  const format   = sp.format === "ride" ? "ride" : sp.format === "a4" ? "a4" : "ticket";
  const supabase = await createClient();
  const tenantId = membership.tenant_id;

  // ── 1. Fetch sale (flat — no embedded joins) ───────────────────────────────
  //
  // Reason: a single mega-query with nested PostgREST joins (e.g.
  //   products!product_id, product_presentations!presentation_id) fails with
  //   PGRST200 when any FK relationship isn't in PostgREST's schema cache.
  // That error was swallowed by the old `notFound()` catch-all, producing
  // false 404s even though the sale existed.
  //
  // Solution: keep each query flat; join nothing via PostgREST.
  // Assemble in TypeScript below.

  const { data: sale, error: saleErr } = await supabase
    .from("sales")
    .select(`
      id, sale_date, created_at, status, total, subtotal, tax_total,
      discount_total, document_kind, notes,
      cancelled_at, cancellation_reason,
      customer_id, warehouse_id
    `)
    .eq("id",        id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (saleErr) {
    console.error(`[print/sale] sales query failed — id=${id} tenant=${tenantId}:`,
      saleErr.code, saleErr.message);
    // Not a 404 — DB/schema error.  Show a helpful error screen.
    return <PrintError saleId={id} code={saleErr.code} message={saleErr.message} />;
  }
  if (!sale) {
    // Genuine not-found: PGRST116 or tenant mismatch.
    notFound();
  }

  const s = sale as Record<string, unknown>;

  // ── 2. Parallel fetch: items · payments · returns · tenant ─────────────────

  const [itemsRes, paymentsRes, returnsRes, tenantRes, invoiceRes, fiscalCfgRes] = await Promise.all([
    supabase
      .from("sale_items")
      .select(`
        id, sale_id, product_id, presentation_id,
        item_name, quantity, unit_price, original_unit_price, discount_amount,
        tax_rate, line_total, is_taxable, base_qty,
        price_override_type
      `)
      .eq("sale_id", id),

    supabase
      .from("sale_payments")
      .select("payment_method, amount, reference")
      .eq("sale_id", id),

    supabase
      .from("sale_returns")
      .select(`
        id, return_type, reason, refund_amount, refund_method,
        processed_at, exchange_sale_id,
        exchange_credit_applied, exchange_credit_refunded
      `)
      .eq("original_sale_id", id)
      .eq("tenant_id",        tenantId)
      .order("processed_at", { ascending: true }),

    supabase
      .from("tenants")
      .select("name, business_name, legal_name, ruc, tax_id, address, phone, email")
      .eq("id", tenantId)
      .maybeSingle(),

    // Electronic invoice (optional — missing invoice doesn't block printing)
    supabase
      .from("electronic_invoices")
      .select("doc_number, access_key, authorization_number, authorization_date, sri_environment, status")
      .eq("sale_id",   id)
      .eq("doc_type",  "01")
      .eq("tenant_id", tenantId)
      .maybeSingle(),

    // SRI fiscal config (optional — needed only for RIDE format)
    supabase
      .from("tenant_fiscal_config")
      .select("dir_matriz, dir_estab, obligado_contabilidad, contribuyente_especial")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (itemsRes.error) {
    console.error(`[print/sale] sale_items query failed — sale=${id}:`,
      itemsRes.error.code, itemsRes.error.message);
    return <PrintError saleId={id} code={itemsRes.error.code} message={itemsRes.error.message} />;
  }

  const rawItems    = (itemsRes.data    ?? []) as any[];
  const rawPayments = (paymentsRes.data ?? []) as any[];
  const rawReturns  = (returnsRes.data  ?? []) as any[];
  const tenantRow   = tenantRes.data as Record<string, string | null> | null;
  const invoiceRow  = invoiceRes.data as Record<string, string | null> | null;
  const fiscalRow   = fiscalCfgRes.data as Record<string, unknown> | null;

  // ── 3. Look up products + presentations (only the IDs that appear) ──────────

  const productIds     = [...new Set(rawItems.map((i) => i.product_id  as string).filter(Boolean))];
  const presentationIds = [...new Set(rawItems.map((i) => i.presentation_id as string).filter(Boolean))];

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

    s.customer_id
      ? supabase
          .from("business_partners")
          .select("full_name, document_type, document_number, phone")
          .eq("id", s.customer_id as string)
          .maybeSingle()
      : (Promise.resolve({ data: null, error: null }) as any),

    s.warehouse_id
      ? supabase
          .from("warehouses")
          .select("name")
          .eq("id", s.warehouse_id as string)
          .maybeSingle()
      : (Promise.resolve({ data: null, error: null }) as any),
  ]);

  // ── 4. Build lookup maps ────────────────────────────────────────────────────

  const productMap = new Map<string, { name: string; sku: string; unit: string }>(
    ((productsRes.data ?? []) as any[]).map((p: any) => [
      p.id as string,
      { name: p.name as string, sku: p.sku as string, unit: p.unit as string },
    ]),
  );

  const presMap = new Map<string, string>(
    ((presRes.data ?? []) as any[]).map((p: any) => [p.id as string, p.unit_label as string]),
  );

  const customer = customerRes.data as {
    full_name: string; document_type: string; document_number: string; phone: string | null;
  } | null;

  const warehouse = warehouseRes.data as { name: string } | null;

  // ── 5. Assemble ReceiptData ─────────────────────────────────────────────────

  const data: ReceiptData = {
    id:                  s.id as string,
    sale_date:           s.sale_date as string,
    created_at:          s.created_at as string,
    document_kind:       s.document_kind as string,
    status:              s.status as string,
    total:               Number(s.total          ?? 0),
    subtotal:            Number(s.subtotal        ?? 0),
    tax_total:           Number(s.tax_total       ?? 0),
    discount_total:      Number(s.discount_total  ?? 0),
    notes:               (s.notes as string | null) ?? null,
    cancelled_at:        (s.cancelled_at        as string | null) ?? null,
    cancellation_reason: (s.cancellation_reason as string | null) ?? null,

    customer: customer
      ? {
          full_name:       customer.full_name,
          document_type:   customer.document_type,
          document_number: customer.document_number,
          phone:           customer.phone,
        }
      : null,

    warehouse: warehouse ? { name: warehouse.name } : null,

    items: rawItems.map((si) => {
      const product      = si.product_id      ? productMap.get(si.product_id as string)      : undefined;
      const presLabel    = si.presentation_id  ? presMap.get(si.presentation_id as string)    : undefined;
      return {
        id:                  si.id as string,
        product_name:        product?.name ?? (si.item_name as string | null) ?? "—",
        product_sku:         product?.sku  ?? "",
        quantity:            Number(si.quantity          ?? 0),
        unit_price:          Number(si.unit_price        ?? 0),
        original_unit_price: si.original_unit_price != null ? Number(si.original_unit_price) : null,
        line_total:          Number(si.line_total        ?? 0),
        discount_amount:     Number(si.discount_amount   ?? 0),
        is_taxable:          Boolean(si.is_taxable),
        tax_rate:            Number(si.tax_rate          ?? 15),
        base_qty:            Number(si.base_qty          ?? 1),
        presentation_label:  presLabel ?? null,
        price_override_type: (si.price_override_type as string | null) ?? null,
      };
    }),

    payments: rawPayments.map((p) => ({
      payment_method: p.payment_method as string,
      amount:         Number(p.amount ?? 0),
      reference:      (p.reference as string | null) ?? null,
    })),

    returns: rawReturns.map((r) => ({
      id:                       r.id as string,
      return_type:              r.return_type as string,
      reason:                   r.reason as string,
      refund_amount:            Number(r.refund_amount ?? 0),
      refund_method:            (r.refund_method as string | null) ?? null,
      processed_at:             r.processed_at as string,
      exchange_sale_id:         (r.exchange_sale_id as string | null) ?? null,
      exchange_credit_applied:  Number(r.exchange_credit_applied  ?? 0),
      exchange_credit_refunded: Number(r.exchange_credit_refunded ?? 0),
    })),

    tenant: {
      name:    tenantRow?.business_name ?? tenantRow?.name ?? "Mi Negocio",
      ruc:     tenantRow?.ruc   ?? tenantRow?.tax_id ?? null,
      address: tenantRow?.address ?? null,
      phone:   tenantRow?.phone   ?? null,
      email:   tenantRow?.email   ?? null,
    },

    invoice: invoiceRow
      ? {
          doc_number:           invoiceRow.doc_number  ?? null,
          access_key:           invoiceRow.access_key  ?? null,
          authorization_number: invoiceRow.authorization_number ?? null,
          authorization_date:   invoiceRow.authorization_date   ?? null,
          sri_environment:      invoiceRow.sri_environment ?? "pruebas",
          status:               invoiceRow.status ?? "draft",
        }
      : null,

    fiscalConfig: fiscalRow
      ? {
          razon_social:           (tenantRow as any)?.legal_name
                                    ?? tenantRow?.business_name
                                    ?? tenantRow?.name
                                    ?? "",
          dir_matriz:             (fiscalRow.dir_matriz             as string | null) ?? "",
          dir_estab:              (fiscalRow.dir_estab              as string | null) ?? null,
          obligado_contabilidad:  Boolean(fiscalRow.obligado_contabilidad ?? false),
          contribuyente_especial: (fiscalRow.contribuyente_especial as string | null) ?? null,
        }
      : null,
  };

  return <ReceiptRenderer data={data} format={format} saleId={id} />;
}
