"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { todayEC } from "@/lib/date-ec";

// ── Types ─────────────────────────────────────────────────────────────────────

type CostSource = "snapshot" | "cpp" | "last" | "zero";

export type ProductProfitRow = {
  product_id:    string;
  name:          string;
  sku:           string;
  unit:          string;
  qty_sold:      number;
  revenue_net:   number;  // s/IVA
  revenue_gross: number;  // c/IVA
  cost_total:    number;
  profit:        number;  // revenue_net - cost_total
  margin:        number;  // profit / revenue_net × 100
  cost_source:   CostSource;
};

export type SaleProfitRow = {
  id:            string;
  display_date:  string;
  document_kind: string;
  customer_name: string;
  revenue_net:   number;
  revenue_gross: number;
  cost_total:    number;
  profit:        number;
  margin:        number;
  cost_source:   CostSource;
};

type Tab  = "product" | "sale";
type SortProduct = "profit" | "revenue" | "margin" | "qty";
type SortSale    = "profit" | "revenue" | "margin";

type Props = {
  from:             string;
  to:               string;
  productRows:      ProductProfitRow[];
  saleRows:         SaleProfitRow[];
  totalRevenueNet:  number;
  totalCost:        number;
  totalProfit:      number;
  globalMargin:     number;
  countSales:       number;
  hasMissingCosts:  boolean;
  negativeProducts: number;
  negativeSales:    number;
  snapshotPct:      number;
};

// ── Formatters ────────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const numFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0, maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit", month: "short", year: "numeric",
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function docKindLabel(k: string) {
  if (k === "invoice") return "Factura";
  if (k === "ticket")  return "Ticket";
  if (k === "quote")   return "Cotización";
  return k;
}

function marginColor(m: number, hasNoCost: boolean) {
  if (hasNoCost) return "text-muted-foreground/40";
  if (m < 0)   return "text-red-400";
  if (m < 10)  return "text-signal-400";
  if (m < 25)  return "text-foreground";
  return "text-safety-500";
}

function marginBarColor(m: number) {
  if (m < 0)  return "bg-red-500/50";
  if (m < 10) return "bg-signal-500/50";
  if (m < 25) return "bg-safety-500/40";
  return "bg-safety-500/60";
}

function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const content = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Cost source label ─────────────────────────────────────────────────────────

function CostSourceBadge({ source }: { source: CostSource }) {
  if (source === "snapshot") return (
    <span className="rounded-sm border border-safety-600/40 bg-safety-700/10 px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-safety-500/70">
      Snapshot
    </span>
  );
  if (source === "last") return (
    <span className="rounded-sm border border-signal-600/30 px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-signal-400/60">
      Últ.compra
    </span>
  );
  if (source === "zero") return (
    <span className="rounded-sm border border-steel-600/50 px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-muted-foreground/40">
      Sin costo
    </span>
  );
  // "cpp"
  return (
    <span className="rounded-sm border border-steel-600/40 px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-muted-foreground/60">
      CPP hoy
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RentabilidadTable({
  from, to,
  productRows, saleRows,
  totalRevenueNet, totalCost, totalProfit, globalMargin,
  countSales, hasMissingCosts,
  negativeProducts, negativeSales, snapshotPct,
}: Props) {
  const router = useRouter();
  // Memoised so it doesn't drift during the session
  const today = React.useMemo(() => todayEC(), []);
  const [fromInput, setFromInput] = React.useState(from);
  // Clamp: if the server somehow passed a future date, cap it to today
  const [toInput, setToInput] = React.useState(() => (to > today ? today : to));
  const [tab,         setTab]         = React.useState<Tab>("product");
  const [sortProduct, setSortProduct] = React.useState<SortProduct>("profit");
  const [sortSale,    setSortSale]    = React.useState<SortSale>("profit");

  const applyFilter = () => {
    if (!fromInput || !toInput) return;
    const clampedTo = toInput > today ? today : toInput;
    router.push(`/dashboard/pos/rentabilidad?from=${fromInput}&to=${clampedTo}`, { scroll: false });
  };

  // ── Sorted product rows ──────────────────────────────────────────────────
  const sortedProducts = React.useMemo(() => {
    return [...productRows].sort((a, b) => {
      if (sortProduct === "profit")  return b.profit       - a.profit;
      if (sortProduct === "revenue") return b.revenue_net  - a.revenue_net;
      if (sortProduct === "margin")  return b.margin       - a.margin;
      return b.qty_sold - a.qty_sold;
    });
  }, [productRows, sortProduct]);

  // ── Sorted sale rows ─────────────────────────────────────────────────────
  const sortedSales = React.useMemo(() => {
    return [...saleRows].sort((a, b) => {
      if (sortSale === "profit")  return b.profit      - a.profit;
      if (sortSale === "revenue") return b.revenue_net - a.revenue_net;
      return b.margin - a.margin;
    });
  }, [saleRows, sortSale]);

  // Max profit for bar scaling
  const maxProductProfit = React.useMemo(
    () => Math.max(1, ...productRows.map((r) => Math.abs(r.profit))),
    [productRows]
  );

  const exportProducts = () => {
    downloadCsv(
      `rentabilidad_productos_${from}_${to}.csv`,
      ["Producto", "SKU", "Unidad", "Unidades_Vendidas",
       "Ventas_Netas_sIVA", "Costo_Total", "Utilidad_Bruta", "Margen_%", "Fuente_Costo"],
      sortedProducts.map((r) => [
        r.name, r.sku, r.unit,
        numFmt.format(r.qty_sold),
        r.revenue_net.toFixed(2),
        r.cost_total.toFixed(2),
        r.profit.toFixed(2),
        r.margin.toFixed(2),
        r.cost_source === "cpp" ? "CPP (Costo Promedio)" :
        r.cost_source === "last" ? "Último costo compra" : "Sin costo registrado",
      ])
    );
  };

  const exportSales = () => {
    downloadCsv(
      `rentabilidad_ventas_${from}_${to}.csv`,
      ["Fecha", "Tipo", "Cliente", "Ventas_Netas_sIVA",
       "Ventas_Brutas_cIVA", "Costo_Estimado", "Utilidad_Bruta", "Margen_%"],
      sortedSales.map((r) => [
        r.display_date,
        docKindLabel(r.document_kind),
        r.customer_name,
        r.revenue_net.toFixed(2),
        r.revenue_gross.toFixed(2),
        r.cost_total.toFixed(2),
        r.profit.toFixed(2),
        r.margin.toFixed(2),
      ])
    );
  };

  const hasData = productRows.length > 0 || saleRows.length > 0;

  return (
    <div className="space-y-6">

      {/* ── Filters + controls ──────────────────────────────────────────── */}
      <div className="panel rounded-sm">
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="space-y-1">
            <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
              Desde
            </label>
            <Input type="date" value={fromInput} max={today} onChange={(e) => setFromInput(e.target.value)} mono className="h-9 w-full sm:w-40" />
          </div>
          <div className="space-y-1">
            <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
              Hasta
            </label>
            <Input type="date" value={toInput} max={today} onChange={(e) => setToInput(e.target.value > today ? today : e.target.value)} mono className="h-9 w-full sm:w-40" />
          </div>
          <Button type="button" size="md" onClick={applyFilter}>Aplicar</Button>
        </div>
        <div className="border-t border-steel-800/60 px-5 py-2">
          <p className="font-mono text-[10px] text-muted-foreground/50">
            {from} → {to} · {countSales} venta{countSales !== 1 ? "s" : ""} confirmada{countSales !== 1 ? "s" : ""} · {productRows.length} producto{productRows.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {!hasData ? (
        <div className="panel rounded-sm px-6 py-12 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            Sin ventas confirmadas en el período seleccionado.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI cards ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Ventas netas"   value={moneyFmt.format(totalRevenueNet)} sub="s/IVA" />
            <KpiCard label="Costo total"    value={moneyFmt.format(totalCost)} />
            <KpiCard
              label="Utilidad bruta"
              value={moneyFmt.format(totalProfit)}
              highlight={totalProfit > 0}
              warn={totalProfit < 0}
            />
            <KpiCard
              label="Margen global"
              value={`${globalMargin.toFixed(1)}%`}
              sub="utilidad / ventas netas"
              highlight={globalMargin >= 25}
              warn={globalMargin < 0}
            />
          </div>

          {/* ── Alert KPIs ──────────────────────────────────────────────── */}
          {(negativeProducts > 0 || negativeSales > 0) ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {negativeProducts > 0 ? (
                <KpiCard
                  label="Productos en pérdida"
                  value={String(negativeProducts)}
                  sub="utilidad bruta negativa"
                  danger
                />
              ) : null}
              {negativeSales > 0 ? (
                <KpiCard
                  label="Ventas en pérdida"
                  value={String(negativeSales)}
                  sub="documentos bajo costo"
                  danger
                />
              ) : null}
              <KpiCard
                label="Costo histórico"
                value={`${snapshotPct}%`}
                sub="productos con snapshot v17"
                highlight={snapshotPct === 100}
              />
            </div>
          ) : snapshotPct < 100 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiCard
                label="Costo histórico"
                value={`${snapshotPct}%`}
                sub={snapshotPct === 100 ? "todos con snapshot" : "snapshot disponible"}
                highlight={snapshotPct === 100}
              />
            </div>
          ) : null}

          {/* Costo disclaimer */}
          {hasMissingCosts || snapshotPct < 100 ? (
            <div className="panel rounded-sm border-l-2 border-signal-700/40 px-5 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-signal-400/70">
                Fuentes de costo activas
              </p>
              <p className="mt-0.5 font-mono text-[11px] leading-5 text-muted-foreground/60">
                <strong className="text-safety-500/80">Snapshot</strong> = costo capturado al momento exacto de la venta (ventas con trigger v17).{" "}
                <strong className="text-muted-foreground">CPP hoy</strong> = promedio ponderado actual (ventas anteriores al trigger — puede diferir del costo real en esa fecha).{" "}
                {hasMissingCosts ? "Algunos productos sin costo (servicios o sin compras previas)." : ""}
              </p>
            </div>
          ) : null}

          {/* ── Tab selector + sort + export ────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Tabs */}
            <div className="flex rounded-sm border border-steel-700 bg-steel-900">
              {(["product", "sale"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={[
                    "px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors",
                    tab === t ? "bg-steel-700 text-foreground" : "text-muted-foreground/70 hover:text-foreground",
                  ].join(" ")}
                >
                  {t === "product" ? "Por Producto" : "Por Venta"}
                </button>
              ))}
            </div>

            {/* Sort (product) */}
            {tab === "product" ? (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/50">
                  Orden:
                </span>
                {(["profit", "revenue", "margin", "qty"] as SortProduct[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSortProduct(s)}
                    className={[
                      "rounded-sm border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] transition-colors",
                      sortProduct === s
                        ? "border-safety-500/50 bg-safety-700/10 text-safety-500"
                        : "border-steel-700 text-muted-foreground/50 hover:text-foreground",
                    ].join(" ")}
                  >
                    {s === "profit" ? "Utilidad" : s === "revenue" ? "Ventas" : s === "margin" ? "Margen" : "Unidades"}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/50">
                  Orden:
                </span>
                {(["profit", "revenue", "margin"] as SortSale[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSortSale(s)}
                    className={[
                      "rounded-sm border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] transition-colors",
                      sortSale === s
                        ? "border-safety-500/50 bg-safety-700/10 text-safety-500"
                        : "border-steel-700 text-muted-foreground/50 hover:text-foreground",
                    ].join(" ")}
                  >
                    {s === "profit" ? "Utilidad" : s === "revenue" ? "Ventas" : "Margen"}
                  </button>
                ))}
              </div>
            )}

            {/* Export */}
            <button
              type="button"
              onClick={tab === "product" ? exportProducts : exportSales}
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              CSV
            </button>
          </div>

          {/* ── Product table ────────────────────────────────────────────── */}
          {tab === "product" ? (
            <section className="panel rounded-sm">
              <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
                <h2 className="font-display text-[16px] tracking-[0.04em]">POR PRODUCTO</h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                  {sortedProducts.length} productos
                </span>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="border-b border-steel-800 bg-steel-950/40">
                    <tr>
                      <Th>Producto</Th>
                      <Th className="text-right">Unidades</Th>
                      <Th className="text-right">Ventas netas</Th>
                      <Th className="text-right">Costo total</Th>
                      <Th className="text-right">Utilidad bruta</Th>
                      <Th className="w-32">Margen</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProducts.map((r) => {
                      const noCost   = r.cost_source === "zero";
                      const barPct   = totalProfit > 0 && r.profit > 0
                        ? Math.min(100, (r.profit / totalProfit) * 100)
                        : 0;
                      const marginClamped = Math.min(100, Math.max(0, r.margin));
                      return (
                        <tr key={r.product_id} className="border-b border-steel-800/50 transition-colors hover:bg-steel-900/40">
                          <Td>
                            <div className="font-semibold text-[13px] text-foreground">{r.name}</div>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span className="font-mono text-[10px] text-muted-foreground/60">{r.sku}</span>
                              <CostSourceBadge source={r.cost_source} />
                              {r.profit < 0 && !noCost ? (
                                <span className="rounded-sm border border-red-500/40 bg-red-500/10 px-1 py-0.5 font-mono text-[8px] font-bold uppercase text-red-400">
                                  pérdida
                                </span>
                              ) : null}
                            </div>
                          </Td>
                          <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                            {numFmt.format(r.qty_sold)} {r.unit}
                          </Td>
                          <Td className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                            {moneyFmt.format(r.revenue_net)}
                          </Td>
                          <Td className="text-right font-mono text-[12.5px] tabular-nums text-muted-foreground/80">
                            {noCost ? <span className="text-muted-foreground/30">—</span> : moneyFmt.format(r.cost_total)}
                          </Td>
                          <Td className={[
                            "text-right font-mono text-[14px] font-bold tabular-nums",
                            noCost ? "text-muted-foreground/30" :
                            r.profit < 0 ? "text-red-400" : "text-foreground",
                          ].join(" ")}>
                            {noCost ? "—" : moneyFmt.format(r.profit)}
                          </Td>
                          <Td>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-steel-800">
                                  {!noCost ? (
                                    <div
                                      className={`h-full rounded-full transition-all ${marginBarColor(r.margin)}`}
                                      style={{ width: `${marginClamped.toFixed(1)}%` }}
                                    />
                                  ) : null}
                                </div>
                                <span className={`w-12 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums ${marginColor(r.margin, noCost)}`}>
                                  {noCost ? "—" : `${r.margin.toFixed(1)}%`}
                                </span>
                              </div>
                              {/* Utilidad contribution bar */}
                              {barPct > 0 ? (
                                <div className="flex items-center gap-2">
                                  <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-steel-800">
                                    <div
                                      className="h-full rounded-full bg-safety-500/30"
                                      style={{ width: `${barPct.toFixed(1)}%` }}
                                    />
                                  </div>
                                  <span className="w-12 shrink-0 text-right font-mono text-[9px] tabular-nums text-muted-foreground/40">
                                    {barPct.toFixed(0)}% del tot.
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-steel-700 bg-steel-950/60">
                      <td className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                        Total período
                      </td>
                      <td />
                      <td className="px-5 py-3 text-right font-mono text-[13px] font-bold tabular-nums text-muted-foreground">
                        {moneyFmt.format(totalRevenueNet)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-[13px] font-bold tabular-nums text-muted-foreground/70">
                        {moneyFmt.format(totalCost)}
                      </td>
                      <td className={[
                        "px-5 py-3 text-right font-mono text-[14px] font-bold tabular-nums",
                        totalProfit >= 0 ? "text-safety-500" : "text-red-400",
                      ].join(" ")}>
                        {moneyFmt.format(totalProfit)}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`font-mono text-[13px] font-bold ${globalMargin >= 0 ? "text-safety-500" : "text-red-400"}`}>
                          {globalMargin.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ) : (

          /* ── Sale table ─────────────────────────────────────────────── */
            <section className="panel rounded-sm">
              <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
                <h2 className="font-display text-[16px] tracking-[0.04em]">POR VENTA</h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                  {sortedSales.length} documentos
                </span>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead className="border-b border-steel-800 bg-steel-950/40">
                    <tr>
                      <Th>Fecha</Th>
                      <Th>Cliente</Th>
                      <Th>Tipo</Th>
                      <Th className="text-right">Ventas netas</Th>
                      <Th className="text-right">Costo est.</Th>
                      <Th className="text-right">Utilidad</Th>
                      <Th className="text-right">Margen</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSales.map((r) => (
                      <tr key={r.id} className="border-b border-steel-800/50 transition-colors hover:bg-steel-900/40">
                        <Td className="whitespace-nowrap">
                          <span className="font-mono text-[11.5px] tabular-nums text-foreground">
                            {dateFmt.format(new Date(r.display_date + "T00:00:00"))}
                          </span>
                        </Td>
                        <Td className="font-semibold text-[13px] text-foreground">{r.customer_name}</Td>
                        <Td>
                          <span className="rounded-sm border border-steel-600 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground/70">
                            {docKindLabel(r.document_kind)}
                          </span>
                        </Td>
                        <Td className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                          {moneyFmt.format(r.revenue_net)}
                        </Td>
                        <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground/70">
                          {r.cost_total > 0 ? moneyFmt.format(r.cost_total) : <span className="text-muted-foreground/30">—</span>}
                        </Td>
                        <Td className={[
                          "text-right font-mono text-[13px] font-bold tabular-nums",
                          r.profit < 0 ? "text-red-400" : r.cost_total === 0 ? "text-muted-foreground/30" : "text-foreground",
                        ].join(" ")}>
                          {r.cost_total === 0 ? "—" : moneyFmt.format(r.profit)}
                        </Td>
                        <Td className="text-right">
                          {r.cost_total === 0 ? (
                            <span className="font-mono text-[10px] text-muted-foreground/30">—</span>
                          ) : (
                            <span className={`font-mono text-[12px] font-bold tabular-nums ${marginColor(r.margin, false)}`}>
                              {r.margin.toFixed(1)}%
                            </span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-steel-700 bg-steel-950/60">
                      <td colSpan={3} className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                        Total período
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-[13px] font-bold tabular-nums text-muted-foreground">
                        {moneyFmt.format(totalRevenueNet)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-[13px] font-bold tabular-nums text-muted-foreground/70">
                        {moneyFmt.format(totalCost)}
                      </td>
                      <td className={[
                        "px-5 py-3 text-right font-mono text-[14px] font-bold tabular-nums",
                        totalProfit >= 0 ? "text-safety-500" : "text-red-400",
                      ].join(" ")}>
                        {moneyFmt.format(totalProfit)}
                      </td>
                      <td className={`px-5 py-3 text-right font-mono text-[13px] font-bold ${globalMargin >= 0 ? "text-safety-500" : "text-red-400"}`}>
                        {globalMargin.toFixed(1)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="border-t border-steel-800 px-5 py-2.5">
                <p className="font-mono text-[10px] text-muted-foreground/45">
                  Costo estimado: CPP actual × unidades vendidas. Ventas sin costo muestran "—" (servicios o productos sin compras previas).
                </p>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, highlight, warn, danger,
}: {
  label:      string;
  value:      string;
  sub?:       string;
  highlight?: boolean;
  warn?:      boolean;
  danger?:    boolean;
}) {
  return (
    <div className={[
      "panel rounded-sm px-4 py-3.5",
      highlight ? "border-safety-500/50" : danger ? "border-red-500/40" : "",
    ].join(" ")}>
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">{label}</div>
      <div className={[
        "mt-1 font-mono text-[19px] font-bold tabular-nums sm:text-[21px]",
        danger    ? "text-red-400"    :
        highlight ? "text-safety-500" :
        warn      ? "text-signal-400" :
                    "text-foreground",
      ].join(" ")}>
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/50">{sub}</div>
      ) : null}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={"px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground " + (className ?? "")}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-5 py-3.5 align-middle " + (className ?? "")}>{children}</td>;
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
