import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { IvaReportTable, type IvaRow } from "./iva-report-table";

export const metadata: Metadata = { title: "IVA Compras · SaturLub" };
export const dynamic = "force-dynamic";

// ── Default date range: current month ─────────────────────────────────────────

function defaultRange(): { from: string; to: string } {
  const now  = new Date();
  const year = now.getFullYear();
  const mo   = String(now.getMonth() + 1).padStart(2, "0");
  const day  = String(now.getDate()).padStart(2, "0");
  return { from: `${year}-${mo}-01`, to: `${year}-${mo}-${day}` };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RawPO = {
  id: string;
  created_at: string;
  purchase_date: string | null;
  document_number: string | null;
  notes: string | null;
  subtotal: number | string;
  tax_total: number | string;
  total: number | string;
  other_charges: number | string | null;
  tax_rate: number | string;
  is_tax_inclusive: boolean;
  status: string;
  business_partners: { id: string; full_name: string; document_number: string | null } | null;
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function IvaComprasPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const params  = await searchParams;
  const def     = defaultRange();
  const from    = params.from ?? def.from;
  const to      = params.to   ?? def.to;

  const supabase = await createClient();

  // ── Fetch received POs in date range ──────────────────────────────────────
  // Filter on created_at (always present).  purchase_date (when set by user)
  // is shown for display; for pure fiscal reporting this is the closest proxy.
  const { data: rawData, error } = await supabase
    .from("purchase_orders")
    .select(`
      id, created_at, purchase_date, document_number, notes,
      subtotal, tax_total, total, tax_rate, is_tax_inclusive,
      other_charges,
      status,
      business_partners ( id, full_name, document_number )
    `)
    .eq("status", "received")
    .gte("created_at", `${from}T00:00:00`)
    .lte("created_at", `${to}T23:59:59`)
    .order("created_at", { ascending: false });

  if (error) console.error("IvaComprasPage:", error);

  const rows: IvaRow[] = ((rawData ?? []) as unknown as RawPO[]).map((po) => ({
    id:               po.id,
    display_date:     po.purchase_date ?? po.created_at.slice(0, 10),
    created_at:       po.created_at,
    document_ref:     po.notes?.slice(0, 60) ?? po.document_number ?? null,
    supplier_id:      po.business_partners?.id ?? null,
    supplier_name:    po.business_partners?.full_name ?? "—",
    supplier_ruc:     po.business_partners?.document_number ?? null,
    subtotal:         Number(po.subtotal   ?? 0),
    tax_total:        Number(po.tax_total  ?? 0),
    total:            Number(po.total      ?? 0),
    other_charges:    Number(po.other_charges ?? 0),
    tax_rate:         Number(po.tax_rate   ?? 0),
    is_tax_inclusive: po.is_tax_inclusive,
  }));

  // ── Aggregates (server-side, passed as props) ──────────────────────────────
  const totalSubtotal     = rows.reduce((s, r) => s + r.subtotal,   0);
  const totalTax          = rows.reduce((s, r) => s + r.tax_total,  0);
  const totalGrand        = rows.reduce((s, r) => s + r.total,      0);
  const totalOtherCharges = rows.reduce((s, r) => s + r.other_charges, 0);
  const count             = rows.length;

  // Group by tax rate for desglose
  type RateAgg = { rate: number; subtotal: number; tax: number; total: number; count: number };
  const rateMap = new Map<number, RateAgg>();
  for (const r of rows) {
    const existing = rateMap.get(r.tax_rate) ?? { rate: r.tax_rate, subtotal: 0, tax: 0, total: 0, count: 0 };
    existing.subtotal += r.subtotal;
    existing.tax      += r.tax_total;
    existing.total    += r.total;
    existing.count    += 1;
    rateMap.set(r.tax_rate, existing);
  }
  const byRate = Array.from(rateMap.values()).sort((a, b) => b.rate - a.rate);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Compras · Fiscal</span>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
              IVA COMPRAS
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Resumen fiscal de compras recibidas. Solo incluye órdenes con estado <em>Recibido</em>.
            </p>
          </div>
        </div>
      </header>

      <IvaReportTable
        rows={rows}
        from={from}
        to={to}
        totalSubtotal={totalSubtotal}
        totalTax={totalTax}
        totalGrand={totalGrand}
        totalOtherCharges={totalOtherCharges}
        count={count}
        byRate={byRate}
      />
    </div>
  );
}
