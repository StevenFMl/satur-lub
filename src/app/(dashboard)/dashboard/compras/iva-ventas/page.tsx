import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { IvaVentasTable, type SaleRow } from "./iva-ventas-table";

export const metadata: Metadata = { title: "IVA Ventas · SaturLub" };
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

type RawItem = {
  tax_rate:    number | string;
  is_taxable:  boolean;
  line_total:  number | string;
};

type RawSale = {
  id:             string;
  created_at:     string;
  sale_date:      string | null;
  document_kind:  string;
  subtotal:       number | string;
  tax_total:      number | string;
  total:          number | string;
  discount_total: number | string;
  business_partners: { id: string; full_name: string; document_number: string | null } | null;
  sale_items: RawItem[];
};

// ── Page ──────────────────────────────────────────────────────────────────────

// Valid document kinds for the filter param
const ALL_KINDS = ["invoice", "ticket", "quote", "note"] as const;
type DocKind = (typeof ALL_KINDS)[number];

function parseKinds(raw: string | undefined): DocKind[] | null {
  if (!raw || raw === "all") return null; // null = no filter (all kinds)
  const parsed = raw.split(",").filter((k): k is DocKind =>
    (ALL_KINDS as readonly string[]).includes(k)
  );
  return parsed.length > 0 ? parsed : null;
}

export default async function IvaVentasPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; kinds?: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const params     = await searchParams;
  const def        = defaultRange();
  const from       = params.from  ?? def.from;
  const to         = params.to    ?? def.to;
  const kindsParam = params.kinds ?? "all";
  const kindsFilter = parseKinds(kindsParam);

  const supabase = await createClient();

  let query = supabase
    .from("sales")
    .select(`
      id, created_at, sale_date, document_kind,
      subtotal, tax_total, total, discount_total,
      business_partners ( id, full_name, document_number ),
      sale_items ( tax_rate, is_taxable, line_total )
    `)
    .eq("status", "confirmed")
    .gte("created_at", `${from}T00:00:00`)
    .lte("created_at", `${to}T23:59:59`)
    .order("created_at", { ascending: false });

  if (kindsFilter) {
    query = query.in("document_kind", kindsFilter);
  }

  const { data: rawData, error } = await query;

  if (error) console.error("IvaVentasPage:", error);

  const raw = (rawData ?? []) as unknown as RawSale[];

  // ── Map rows (header-level only for the table) ───────────────────────────
  const rows: SaleRow[] = raw.map((s) => ({
    id:             s.id,
    display_date:   s.sale_date ?? s.created_at.slice(0, 10),
    created_at:     s.created_at,
    document_kind:  s.document_kind,
    customer_name:  s.business_partners?.full_name ?? "—",
    customer_ruc:   s.business_partners?.document_number ?? null,
    subtotal:       Number(s.subtotal       ?? 0),
    tax_total:      Number(s.tax_total      ?? 0),
    total:          Number(s.total          ?? 0),
    discount_total: Number(s.discount_total ?? 0),
  }));

  // ── Aggregates ───────────────────────────────────────────────────────────
  const totalSubtotal = rows.reduce((s, r) => s + r.subtotal,  0);
  const totalTax      = rows.reduce((s, r) => s + r.tax_total, 0);
  const totalGrand    = rows.reduce((s, r) => s + r.total,     0);
  const count         = rows.length;

  // ── By-rate breakdown (from embedded sale_items) ─────────────────────────
  // Each item carries its own tax_rate + is_taxable.
  // line_total is GROSS (qty × unit_price - discount).
  // net  = gross / (1 + rate/100)   [when taxable & rate > 0]
  // tax  = gross - net              [when taxable & rate > 0]
  type RateAgg = { rate: number; label: string; net: number; tax: number; gross: number };
  const rateMap = new Map<string, RateAgg>();

  for (const s of raw) {
    for (const item of s.sale_items ?? []) {
      const isTaxable    = item.is_taxable !== false;
      const rate         = Number(item.tax_rate ?? 0);
      const gross        = Number(item.line_total ?? 0);
      const effectiveRate = isTaxable ? rate : 0;
      const net          = effectiveRate > 0 ? gross / (1 + effectiveRate / 100) : gross;
      const tax          = effectiveRate > 0 ? gross - net : 0;
      const key          = isTaxable ? String(rate) : "exempt";
      const label        = isTaxable ? (rate === 0 ? "Exento (0%)" : `${rate}%`) : "Exento";

      const e = rateMap.get(key) ?? { rate: effectiveRate, label, net: 0, tax: 0, gross: 0 };
      e.net   += net;
      e.tax   += tax;
      e.gross += gross;
      rateMap.set(key, e);
    }
  }

  const byRate = Array.from(rateMap.values()).sort((a, b) => b.rate - a.rate);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Ventas · Fiscal</span>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
              IVA VENTAS
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              Resumen fiscal de ventas confirmadas. Solo incluye ventas con estado{" "}
              <em>Confirmado</em>.
            </p>
          </div>
        </div>
      </header>

      <IvaVentasTable
        rows={rows}
        from={from}
        to={to}
        kinds={kindsParam}
        totalSubtotal={totalSubtotal}
        totalTax={totalTax}
        totalGrand={totalGrand}
        count={count}
        byRate={byRate}
      />
    </div>
  );
}
