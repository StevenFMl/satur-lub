import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/supabase/membership";
import { ConsolidadoTable, type MonthData } from "./consolidado-table";

export const metadata: Metadata = { title: "Consolidado IVA · SaturLub" };
export const dynamic = "force-dynamic";

// ── Types ─────────────────────────────────────────────────────────────────────

type RawSale = {
  created_at: string;
  subtotal:   number | string;
  tax_total:  number | string;
  total:      number | string;
};

type RawPO = {
  created_at: string;
  subtotal:   number | string;
  tax_total:  number | string;
  total:      number | string;
  tax_rate:   number | string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function monthOf(iso: string) { return iso.slice(0, 7); } // "2026-01"

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ConsolidadoPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { user, membership } = await getActiveMembership();
  if (!user)       redirect("/login");
  if (!membership) redirect("/onboarding");

  const params   = await searchParams;
  const year     = params.year ?? String(new Date().getFullYear());
  const yearFrom = `${year}-01-01T00:00:00`;
  const yearTo   = `${year}-12-31T23:59:59`;

  const supabase = await createClient();

  // Parallel fetch — header-level totals only (no items embedding)
  const [{ data: saleData, error: saleErr }, { data: poData, error: poErr }] =
    await Promise.all([
      supabase
        .from("sales")
        .select("created_at, subtotal, tax_total, total")
        .eq("status", "confirmed")
        .gte("created_at", yearFrom)
        .lte("created_at", yearTo),
      supabase
        .from("purchase_orders")
        .select("created_at, subtotal, tax_total, total, tax_rate")
        .eq("status", "received")
        .gte("created_at", yearFrom)
        .lte("created_at", yearTo),
    ]);

  if (saleErr) console.error("ConsolidadoPage [ventas]:", saleErr);
  if (poErr)   console.error("ConsolidadoPage [compras]:", poErr);

  const sales = (saleData ?? []) as unknown as RawSale[];
  const pos   = (poData   ?? []) as unknown as RawPO[];

  // ── Build month map ──────────────────────────────────────────────────────
  // Initialise all 12 months so months with no data still appear as zeros.
  const monthMap = new Map<string, MonthData>();
  const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  for (let m = 1; m <= 12; m++) {
    const key   = `${year}-${String(m).padStart(2, "0")}`;
    const label = `${MONTHS_ES[m - 1]} ${year}`;
    monthMap.set(key, {
      yearMonth:      key,
      label,
      subtotalVentas: 0, ivaVentas: 0, totalVentas: 0, countVentas: 0,
      subtotalCompras: 0, ivaCompras: 0, totalCompras: 0, countCompras: 0,
      ivaVentasGravadas: 0, subtotalVentasGravadas: 0,
      ivaVentasExentas: 0, subtotalVentasExentas: 0,
      ivaCompras15: 0, subtotalCompras15: 0,
      ivaCompras0:  0, subtotalCompras0: 0,
    });
  }

  // Ventas por mes
  for (const s of sales) {
    const key = monthOf(s.created_at);
    if (!monthMap.has(key)) continue; // fuera del año
    const m   = monthMap.get(key)!;
    const sub = Number(s.subtotal  ?? 0);
    const tax = Number(s.tax_total ?? 0);
    const tot = Number(s.total     ?? 0);
    m.subtotalVentas += sub;
    m.ivaVentas      += tax;
    m.totalVentas    += tot;
    m.countVentas    += 1;
    // Approximation: tax_total > 0 ⟹ gravada (works for single-rate sales)
    if (tax > 0.001) {
      m.subtotalVentasGravadas += sub;
      m.ivaVentasGravadas      += tax;
    } else {
      m.subtotalVentasExentas  += sub;
    }
  }

  // Compras por mes (split por tax_rate)
  for (const p of pos) {
    const key = monthOf(p.created_at);
    if (!monthMap.has(key)) continue;
    const m    = monthMap.get(key)!;
    const sub  = Number(p.subtotal  ?? 0);
    const tax  = Number(p.tax_total ?? 0);
    const tot  = Number(p.total     ?? 0);
    const rate = Number(p.tax_rate  ?? 0);
    m.subtotalCompras += sub;
    m.ivaCompras      += tax;
    m.totalCompras    += tot;
    m.countCompras    += 1;
    if (rate > 0) {
      m.subtotalCompras15 += sub;
      m.ivaCompras15      += tax;
    } else {
      m.subtotalCompras0  += sub;
    }
  }

  const months = Array.from(monthMap.values());

  // ── Year totals ──────────────────────────────────────────────────────────
  const totales: MonthData = {
    yearMonth: year,
    label:     `Total ${year}`,
    subtotalVentas:         months.reduce((s, m) => s + m.subtotalVentas, 0),
    ivaVentas:              months.reduce((s, m) => s + m.ivaVentas, 0),
    totalVentas:            months.reduce((s, m) => s + m.totalVentas, 0),
    countVentas:            months.reduce((s, m) => s + m.countVentas, 0),
    subtotalCompras:        months.reduce((s, m) => s + m.subtotalCompras, 0),
    ivaCompras:             months.reduce((s, m) => s + m.ivaCompras, 0),
    totalCompras:           months.reduce((s, m) => s + m.totalCompras, 0),
    countCompras:           months.reduce((s, m) => s + m.countCompras, 0),
    ivaVentasGravadas:      months.reduce((s, m) => s + m.ivaVentasGravadas, 0),
    subtotalVentasGravadas: months.reduce((s, m) => s + m.subtotalVentasGravadas, 0),
    ivaVentasExentas:       0,
    subtotalVentasExentas:  months.reduce((s, m) => s + m.subtotalVentasExentas, 0),
    ivaCompras15:           months.reduce((s, m) => s + m.ivaCompras15, 0),
    subtotalCompras15:      months.reduce((s, m) => s + m.subtotalCompras15, 0),
    ivaCompras0:            0,
    subtotalCompras0:       months.reduce((s, m) => s + m.subtotalCompras0, 0),
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <header className="space-y-2">
        <span className="hud-readout">Fiscal · Consolidado</span>
        <div>
          <h1 className="font-display text-[36px] leading-none tracking-[0.02em] text-foreground sm:text-[42px]">
            CONSOLIDADO IVA
          </h1>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Ventas confirmadas y compras recibidas agrupadas por período.
            Base para Formulario 104 SRI.
          </p>
        </div>
      </header>

      <ConsolidadoTable
        year={year}
        months={months}
        totales={totales}
      />
    </div>
  );
}

