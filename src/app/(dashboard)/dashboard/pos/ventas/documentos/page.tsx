import type { Metadata }     from "next";
import { redirect }          from "next/navigation";
import { createClient }      from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { getPosPermissions } from "@/lib/auth/permissions";
import { DocumentsTable }    from "./documents-table";

export const metadata: Metadata = { title: "Comprobantes electrónicos · SaturLub" };
export const dynamic = "force-dynamic";

// ── Types ──────────────────────────────────────────────────────────────────

export type InvoiceListItem = {
  id:                   string;
  doc_number:           string;
  access_key:           string | null;
  status:               string;
  sri_environment:      string;
  authorization_number: string | null;
  authorization_date:   string | null;
  created_at:           string;
  sale_id:              string | null;
  // From sale join
  sale_date:            string | null;
  sale_total:           number | null;
  customer_name:        string;
  customer_doc:         string | null;
};

// ── Page ───────────────────────────────────────────────────────────────────

export default async function DocumentosPage() {
  const { user, membership } = await getActiveMembership();
  if (!user) redirect("/login");
  if (!membership) redirect("/onboarding");

  const permissions = getPosPermissions(membership.role);
  if (!permissions.canUsePOS) redirect("/dashboard");

  const canEmit = membership.role === "owner" || membership.role === "admin";

  const supabase  = await createClient();
  const tenantId  = membership.tenant_id;

  // ── Fetch invoices (last 500) ────────────────────────────────────────
  const { data: rawInvoices } = await supabase
    .from("electronic_invoices")
    .select("id, doc_number, access_key, status, sri_environment, authorization_number, authorization_date, created_at, sale_id")
    .eq("doc_type", "01")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(500);

  const invoices = (rawInvoices ?? []) as any[];

  // ── Fetch sale data for invoice sale_ids ─────────────────────────────
  const saleIds = [...new Set(invoices.map((i) => i.sale_id as string).filter(Boolean))];

  const [{ data: salesRaw }, { data: customersRaw }] = await Promise.all([
    saleIds.length > 0
      ? supabase
          .from("sales")
          .select("id, sale_date, total, customer_id")
          .in("id", saleIds)
      : (Promise.resolve({ data: [] }) as any),
    // Fetch customers separately (avoid nested join ambiguity)
    Promise.resolve({ data: [] }) as any,
  ]);

  const sales = (salesRaw ?? []) as any[];

  // Collect customer IDs from sales
  const customerIds = [...new Set(sales.map((s: any) => s.customer_id as string).filter(Boolean))];
  const { data: customersData } = customerIds.length > 0
    ? await supabase
        .from("business_partners")
        .select("id, full_name, document_number")
        .in("id", customerIds)
    : { data: [] };

  // ── Build lookup maps ─────────────────────────────────────────────────
  const customerMap = new Map<string, { name: string; doc: string }>(
    ((customersData ?? []) as any[]).map((c: any) => [
      c.id as string,
      { name: c.full_name as string, doc: (c.document_number as string | null) ?? "" },
    ]),
  );

  const saleMap = new Map<string, { sale_date: string; total: number; customer_id: string }>(
    sales.map((s: any) => [
      s.id as string,
      {
        sale_date:   s.sale_date   as string,
        total:       Number(s.total ?? 0),
        customer_id: s.customer_id as string,
      },
    ]),
  );

  // ── Normalize ─────────────────────────────────────────────────────────
  const list: InvoiceListItem[] = invoices.map((inv: any) => {
    const sale = inv.sale_id ? saleMap.get(inv.sale_id as string) : undefined;
    const cust = sale?.customer_id ? customerMap.get(sale.customer_id) : undefined;
    return {
      id:                   inv.id   as string,
      doc_number:           inv.doc_number as string,
      access_key:           inv.access_key as string | null,
      status:               inv.status    as string,
      sri_environment:      inv.sri_environment as string,
      authorization_number: inv.authorization_number as string | null,
      authorization_date:   inv.authorization_date   as string | null,
      created_at:           inv.created_at as string,
      sale_id:              inv.sale_id   as string | null,
      sale_date:            sale?.sale_date ?? null,
      sale_total:           sale?.total    ?? null,
      customer_name:        cust?.name     ?? "—",
      customer_doc:         cust?.doc      ?? null,
    };
  });

  return (
    <DocumentsTable invoices={list} canEmit={canEmit} />
  );
}
