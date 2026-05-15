import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { ResumenIvaTable } from "./resumen-iva-table";

export const metadata: Metadata = { title: "Resumen IVA · SaturLub" };
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
  tax_total: number | string;
  subtotal:  number | string;
  total:     number | string;
  tax_rate:  number | string;
};

type RawSaleItem = {
  tax_rate:   number | string;
  is_taxable: boolean;
  line_total: number | string;
};

type RawSale = {
  tax_total:      number | string;
  subtotal:       number | string;
  total:          number | string;
  discount_total: number | string;
  sale_items:     RawSaleItem[];
};

export type RateAggCompras = {
  rate:     number;
  subtotal: number;
  tax:      number;
  total:    number;
  count:    number;
};

export type RateAggVentas = {
  rate:  number;
  label: string;
  net:   number;
  tax:   number;
  gross: number;
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ResumenIvaPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const params = await searchParams;
  const def    = defaultRange();
  const from   = params.from ?? def.from;
  const to     = params.to   ?? def.to;

  const supabase = await createClient();

  // ── Parallel queries ────────────────────────────────────────────────────
  const [{ data: poData, error: poError }, { data: saleData, error: saleError }] =
    await Promise.all([
      // Compras: header-level only (tax_rate lives on PO header)
      supabase
        .from("purchase_orders")
        .select("tax_total, subtotal, total, tax_rate")
        .eq("status", "received")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),

      // Ventas: header + embedded sale_items for by-rate breakdown
      supabase
        .from("sales")
        .select("tax_total, subtotal, total, discount_total, sale_items ( tax_rate, is_taxable, line_total )")
        .eq("status", "confirmed")
        .gte("created_at", `${from}T00:00:00`)
        .lte("created_at", `${to}T23:59:59`),
    ]);

  if (poError)   console.error("ResumenIvaPage [compras]:", poError);
  if (saleError) console.error("ResumenIvaPage [ventas]:",  saleError);

  const pos   = (poData   ?? []) as unknown as RawPO[];
  const sales = (saleData ?? []) as unknown as RawSale[];

  // ── Compras aggregates ───────────────────────────────────────────────────
  const ivaCompras      = pos.reduce((s, p) => s + Number(p.tax_total ?? 0), 0);
  const subtotalCompras = pos.reduce((s, p) => s + Number(p.subtotal  ?? 0), 0);
  const totalCompras    = pos.reduce((s, p) => s + Number(p.total     ?? 0), 0);
  const countCompras    = pos.length;

  // Compras by rate (tax_rate on PO header)
  const comprasRateMap = new Map<number, RateAggCompras>();
  for (const p of pos) {
    const rate = Number(p.tax_rate ?? 0);
    const e    = comprasRateMap.get(rate) ?? { rate, subtotal: 0, tax: 0, total: 0, count: 0 };
    e.subtotal += Number(p.subtotal  ?? 0);
    e.tax      += Number(p.tax_total ?? 0);
    e.total    += Number(p.total     ?? 0);
    e.count    += 1;
    comprasRateMap.set(rate, e);
  }
  const byRateCompras = Array.from(comprasRateMap.values()).sort((a, b) => b.rate - a.rate);

  // ── Ventas aggregates ────────────────────────────────────────────────────
  const ivaVentas      = sales.reduce((s, v) => s + Number(v.tax_total ?? 0), 0);
  const subtotalVentas = sales.reduce((s, v) => s + Number(v.subtotal  ?? 0), 0);
  const totalVentas    = sales.reduce((s, v) => s + Number(v.total     ?? 0), 0);
  const countVentas    = sales.length;

  // Ventas by rate (from embedded sale_items)
  const ventasRateMap = new Map<string, RateAggVentas>();
  for (const s of sales) {
    for (const item of s.sale_items ?? []) {
      const isTaxable     = item.is_taxable !== false;
      const rate          = Number(item.tax_rate ?? 0);
      const gross         = Number(item.line_total ?? 0);
      const effectiveRate = isTaxable ? rate : 0;
      const net           = effectiveRate > 0 ? gross / (1 + effectiveRate / 100) : gross;
      const tax           = effectiveRate > 0 ? gross - net : 0;
      const key           = isTaxable ? String(rate) : "exempt";
      const label         = isTaxable ? (rate === 0 ? "Exento (0%)" : `${rate}%`) : "Exento";

      const e = ventasRateMap.get(key) ?? { rate: effectiveRate, label, net: 0, tax: 0, gross: 0 };
      e.net   += net;
      e.tax   += tax;
      e.gross += gross;
      ventasRateMap.set(key, e);
    }
  }
  const byRateVentas = Array.from(ventasRateMap.values()).sort((a, b) => b.rate - a.rate);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Fiscal · SRI</span>
        <div>
          <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
            RESUMEN IVA
          </h1>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            IVA ventas − IVA compras = IVA neto del período.
          </p>
        </div>
      </header>

      <ResumenIvaTable
        from={from}
        to={to}
        ivaVentas={ivaVentas}
        subtotalVentas={subtotalVentas}
        totalVentas={totalVentas}
        countVentas={countVentas}
        byRateVentas={byRateVentas}
        ivaCompras={ivaCompras}
        subtotalCompras={subtotalCompras}
        totalCompras={totalCompras}
        countCompras={countCompras}
        byRateCompras={byRateCompras}
      />
    </div>
  );
}
