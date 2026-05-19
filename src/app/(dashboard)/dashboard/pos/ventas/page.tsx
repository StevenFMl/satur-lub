import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { getPosPermissions } from "@/lib/auth/permissions";
import { SalesHistory } from "./sales-history";
import { todayEC } from "@/lib/date-ec";

export const metadata: Metadata = { title: "Ventas · SaturLub" };
export const dynamic = "force-dynamic";

// ── Shared types ────────────────────────────────────────────────────────────

export type SaleListItem = {
  id:                  string;
  sale_date:           string;
  created_at:          string;
  status:              string;
  total:               number;
  discount_total:      number;
  document_kind:       string;
  cancelled_at:        string | null;
  cancellation_reason: string | null;
  customer_name:       string;
  payment_methods:     string[];
  has_override:        boolean;
  invoice_id:          string | null;
  invoice_status:      string | null;
  invoice_doc_number:  string | null;
  invoice_env:         string | null;
};

export type DaySummary = {
  confirmedCount:   number;
  cancelledCount:   number;
  totalGross:       number;
  totalDiscount:    number;
  overrideCount:    number;
  overrideSavings:  number;
  cancelledGross:   number;
  paymentBreakdown: { method: string; amount: number }[];
};

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const permissions = getPosPermissions(membership.role);
  if (!permissions.canUsePOS) redirect("/dashboard");

  const params    = await searchParams;
  const today     = todayEC();
  const dateParam = params.date ?? today;
  const date      = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const supabase = await createClient();

  // ── 1. Flat sales query (no nested selects — avoids FK hint ambiguity) ───
  const { data: rawSales, error: salesError } = await supabase
    .from("sales")
    .select("id, sale_date, created_at, status, total, discount_total, document_kind, cancelled_at, cancellation_reason, customer_id")
    .eq("sale_date", date)
    .order("created_at", { ascending: false });

  if (salesError) {
    // Log every field — PostgrestError properties are not enumerable so
    // console.error(error) alone prints "{}".
    console.error(
      "VentasPage — sales query failed:",
      salesError.message,
      salesError.code,
      salesError.details,
      salesError.hint
    );
  }

  // Cast to any[] — Supabase type inference breaks on dynamic select strings.
  const sales = (rawSales as any[]) ?? [];
  const saleIds    = sales.map((s) => s.id as string);
  const customerIds = [...new Set(sales.map((s) => s.customer_id as string))];

  // ── 2. Related queries (parallel, guarded against empty arrays) ──────────

  const [
    { data: customers },
    { data: payments },
    { data: overrideItems },
    { data: invoiceRows },
  ] = await Promise.all([
    // Customer names
    customerIds.length > 0
      ? supabase
          .from("business_partners")
          .select("id, full_name")
          .in("id", customerIds)
      : (Promise.resolve({ data: [] }) as any),

    // Payment methods per sale
    saleIds.length > 0
      ? supabase
          .from("sale_payments")
          .select("sale_id, payment_method, amount")
          .in("sale_id", saleIds)
      : (Promise.resolve({ data: [] }) as any),

    // Override items (column added in v4 — graceful if not present)
    saleIds.length > 0
      ? supabase
          .from("sale_items")
          .select("sale_id, original_unit_price, unit_price, quantity")
          .in("sale_id", saleIds)
          .not("original_unit_price", "is", null)
      : (Promise.resolve({ data: [] }) as any),

    // Electronic invoices (facturas tipo 01) for each sale
    saleIds.length > 0
      ? supabase
          .from("electronic_invoices")
          .select("id, sale_id, status, doc_number, sri_environment")
          .in("sale_id", saleIds)
          .eq("doc_type", "01")
      : (Promise.resolve({ data: [] }) as any),
  ]);

  // ── 3. Index data for fast lookups ───────────────────────────────────────

  const customerMap = new Map<string, string>(
    (customers ?? []).map((c: any) => [c.id as string, c.full_name as string])
  );

  // payment methods per sale
  const paymentsBySale = new Map<string, string[]>();
  for (const p of payments ?? []) {
    const sid  = p.sale_id as string;
    const meth = p.payment_method as string;
    const arr  = paymentsBySale.get(sid) ?? [];
    if (!arr.includes(meth)) arr.push(meth);
    paymentsBySale.set(sid, arr);
  }

  // which sale IDs had overrides
  const overrideSet = new Set<string>(
    (overrideItems ?? []).map((i: any) => i.sale_id as string)
  );

  // invoice data per sale
  const invoicesBySale = new Map<string, { id: string; status: string; doc_number: string | null; env: string }>();
  for (const inv of invoiceRows ?? []) {
    invoicesBySale.set(inv.sale_id as string, {
      id:         inv.id as string,
      status:     inv.status as string,
      doc_number: inv.doc_number as string | null,
      env:        inv.sri_environment as string,
    });
  }

  // ── 4. Normalize SaleListItem[] ──────────────────────────────────────────

  const saleList: SaleListItem[] = sales.map((s: any) => ({
    id:                  s.id as string,
    sale_date:           s.sale_date as string,
    created_at:          s.created_at as string,
    status:              s.status as string,
    total:               Number(s.total ?? 0),
    discount_total:      Number(s.discount_total ?? 0),
    document_kind:       s.document_kind as string,
    cancelled_at:        s.cancelled_at as string | null,
    cancellation_reason: s.cancellation_reason as string | null,
    customer_name:       customerMap.get(s.customer_id as string) ?? "—",
    payment_methods:     paymentsBySale.get(s.id as string) ?? [],
    has_override:        overrideSet.has(s.id as string),
    invoice_id:          invoicesBySale.get(s.id as string)?.id           ?? null,
    invoice_status:      invoicesBySale.get(s.id as string)?.status      ?? null,
    invoice_doc_number:  invoicesBySale.get(s.id as string)?.doc_number  ?? null,
    invoice_env:         invoicesBySale.get(s.id as string)?.env         ?? null,
  }));

  // ── 5. Day summary ───────────────────────────────────────────────────────

  const confirmed     = saleList.filter((s) => s.status === "confirmed");
  const cancelled     = saleList.filter((s) => s.status === "cancelled");
  const confirmedIds  = new Set(confirmed.map((s) => s.id));

  // payment breakdown — confirmed sales only
  const pmtMap = new Map<string, number>();
  for (const p of payments ?? []) {
    if (!confirmedIds.has(p.sale_id as string)) continue;
    const m   = p.payment_method as string;
    pmtMap.set(m, (pmtMap.get(m) ?? 0) + Number(p.amount ?? 0));
  }

  // override savings
  let overrideCount   = 0;
  let overrideSavings = 0;
  for (const item of overrideItems ?? []) {
    if (!confirmedIds.has(item.sale_id as string)) continue;
    overrideCount++;
    overrideSavings +=
      (Number(item.original_unit_price) - Number(item.unit_price)) *
      Number(item.quantity);
  }

  const summary: DaySummary = {
    confirmedCount:   confirmed.length,
    cancelledCount:   cancelled.length,
    totalGross:       confirmed.reduce((a, s) => a + s.total, 0),
    totalDiscount:    confirmed.reduce((a, s) => a + s.discount_total, 0),
    overrideCount,
    overrideSavings:  Math.max(overrideSavings, 0),
    cancelledGross:   cancelled.reduce((a, s) => a + s.total, 0),
    paymentBreakdown: Array.from(pmtMap.entries())
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
  };

  const canEmit = membership.role === "owner" || membership.role === "admin";

  return (
    <SalesHistory
      sales={saleList}
      summary={summary}
      date={date}
      canVoidSale={permissions.canVoidSale}
      canEmit={canEmit}
    />
  );
}
