"use client";

import * as React     from "react";
import Link           from "next/link";
import { useRouter }  from "next/navigation";
import { Input }      from "@/components/ui/input";
import type { ProductSalesRow, DrillItem, WarehouseOption } from "./page";

// ── Constants ──────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});
const numFmt = new Intl.NumberFormat("es-EC", { maximumFractionDigits: 1 });
const pctFmt = new Intl.NumberFormat("es-EC", {
  style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
});

type SortMode =
  | "units_desc"
  | "revenue_desc"
  | "profit_desc"
  | "margin_desc"
  | "units_asc";

const SORT_LABELS: Record<SortMode, string> = {
  units_desc:   "Más vendidos (unidades)",
  revenue_desc: "Más vendidos (ingresos)",
  profit_desc:  "Más rentables (ganancia)",
  margin_desc:  "Mejor margen %",
  units_asc:    "Menor rotación",
};

const COST_SOURCE_LABELS: Record<string, string> = {
  snapshot: "Histórico",
  cpp:      "CPP",
  last:     "Últ. compra",
  zero:     "Sin costo",
};

const COST_SOURCE_COLORS: Record<string, string> = {
  snapshot: "text-signal-400/70",
  cpp:      "text-sky-400/70",
  last:     "text-amber-400/60",
  zero:     "text-muted-foreground/40",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00Z").toLocaleDateString("es-EC", {
    timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "2-digit",
  });
}

function marginClass(pct: number): string {
  if (pct >= 30) return "text-signal-400";
  if (pct >= 15) return "text-safety-500";
  if (pct >= 0)  return "text-muted-foreground";
  return "text-red-400";
}

function sortRows(rows: ProductSalesRow[], mode: SortMode): ProductSalesRow[] {
  const copy = [...rows];
  switch (mode) {
    case "units_desc":   return copy.sort((a, b) => b.qty_net      - a.qty_net);
    case "revenue_desc": return copy.sort((a, b) => b.gross_billed - a.gross_billed);
    case "profit_desc":  return copy.sort((a, b) => b.gross_profit - a.gross_profit);
    case "margin_desc":  return copy.sort((a, b) => b.margin_pct   - a.margin_pct);
    case "units_asc":    return copy.sort((a, b) => a.qty_net      - b.qty_net);
  }
}

// ── CSV export ─────────────────────────────────────────────────────────────

function downloadCsv(rows: ProductSalesRow[], from: string, to: string) {
  const headers = [
    "Producto", "SKU", "Unidad", "Unidades vendidas", "Ingresos brutos",
    "Descuento", "IVA", "Ingreso neto", "Costo estimado", "Ganancia",
    "Margen %", "Fuente costo", "Última venta", "N° ventas",
  ];

  const escape = (v: string | number) =>
    typeof v === "string" && (v.includes(",") || v.includes('"') || v.includes("\n"))
      ? `"${v.replace(/"/g, '""')}"`
      : String(v);

  const csvRows = rows.map((r) => [
    escape(r.name),
    escape(r.sku),
    escape(r.unit),
    r.qty_net.toFixed(2),
    r.gross_billed.toFixed(2),
    r.total_discount.toFixed(2),
    r.total_iva.toFixed(2),
    r.net_revenue.toFixed(2),
    r.cost_estimate.toFixed(2),
    r.gross_profit.toFixed(2),
    (r.margin_pct / 100).toFixed(4),
    escape(COST_SOURCE_LABELS[r.cost_source] ?? r.cost_source),
    r.last_sale_date,
    r.sale_count,
  ].join(","));

  const csv  = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `productos-vendidos_${from}_${to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main component ─────────────────────────────────────────────────────────

export function ProductosTable({
  rows,
  warehouses,
  from,
  to,
  warehouseFilter,
}: {
  rows:            ProductSalesRow[];
  warehouses:      WarehouseOption[];
  from:            string;
  to:              string;
  warehouseFilter: string | null;
}) {
  const router = useRouter();

  const [sortMode, setSortMode] = React.useState<SortMode>("revenue_desc");
  const [search,   setSearch]   = React.useState("");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  // ── Date range navigation ──────────────────────────────────────────────
  const [localFrom, setLocalFrom] = React.useState(from);
  const [localTo,   setLocalTo]   = React.useState(to);

  function applyRange() {
    const p = new URLSearchParams();
    if (localFrom) p.set("from", localFrom);
    if (localTo)   p.set("to",   localTo);
    if (warehouseFilter) p.set("warehouse", warehouseFilter);
    router.push(`/dashboard/pos/ventas/productos?${p.toString()}`);
  }

  function applyWarehouse(wid: string) {
    const p = new URLSearchParams();
    p.set("from", from);
    p.set("to", to);
    if (wid) p.set("warehouse", wid);
    router.push(`/dashboard/pos/ventas/productos?${p.toString()}`);
  }

  function toggleDrill(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ── Filter + sort ─────────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? rows.filter((r) =>
          r.name.toLowerCase().includes(q) ||
          r.sku.toLowerCase().includes(q),
        )
      : rows;
    return sortRows(base, sortMode);
  }, [rows, search, sortMode]);

  // ── KPIs ─────────────────────────────────────────────────────────────
  const kpis = React.useMemo(() => {
    const total_units    = rows.reduce((s, r) => s + r.qty_net,       0);
    const total_gross    = rows.reduce((s, r) => s + r.gross_billed,  0);
    const total_net      = rows.reduce((s, r) => s + r.net_revenue,   0);
    const total_cost     = rows.reduce((s, r) => s + r.cost_estimate, 0);
    const total_profit   = total_net - total_cost;
    const total_sales    = new Set(rows.flatMap((r) => r.drill.map((d) => d.sale_id))).size;
    const avg_ticket     = total_sales > 0 ? total_gross / total_sales : 0;
    const avg_margin     = total_net > 0 ? (total_profit / total_net) * 100 : 0;
    const top5           = sortRows([...rows], "revenue_desc").slice(0, 5);
    return {
      total_units, total_gross, total_net, total_profit,
      avg_ticket, avg_margin, total_sales,
      distinct_products: rows.length,
      top5,
    };
  }, [rows]);

  const rowKey = (r: ProductSalesRow) => r.product_id ?? `manual:${r.name}`;

  return (
    <div className="space-y-5">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="hud-readout">Operación · Análisis de ventas</span>
          <h1 className="font-display text-[28px] leading-none tracking-[0.04em] sm:text-[36px]">
            PRODUCTOS VENDIDOS
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground/60">
            {fmtDate(from)} — {fmtDate(to)} · {rows.length} producto{rows.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3 self-start">
          <Link
            href="/dashboard/pos/ventas"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            ← Ventas
          </Link>
        </div>
      </div>

      {/* ── Date range + filters ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-steel-700 bg-steel-900/40 px-4 py-3">
        <div className="flex items-end gap-2">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60 mb-1">Desde</p>
            <input
              type="date"
              value={localFrom}
              onChange={(e) => setLocalFrom(e.target.value)}
              className="rounded-sm border border-steel-700 bg-steel-900 px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
            />
          </div>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60 mb-1">Hasta</p>
            <input
              type="date"
              value={localTo}
              onChange={(e) => setLocalTo(e.target.value)}
              className="rounded-sm border border-steel-700 bg-steel-900 px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={applyRange}
            className="h-8 rounded-sm border border-safety-500/50 bg-safety-500/10 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-safety-500 hover:bg-safety-500/20 transition-colors"
          >
            Aplicar
          </button>
        </div>

        {/* Quick ranges */}
        <div className="flex gap-1 flex-wrap">
          {[
            { label: "Este mes", fn: () => { const t = new Date(); const y = t.getFullYear(); const m = String(t.getMonth()+1).padStart(2,"0"); return { f: `${y}-${m}-01`, t: to }; } },
            { label: "Últ. 30d", fn: () => { const t = new Date(); const d = new Date(t); d.setDate(t.getDate()-30); return { f: d.toISOString().slice(0,10), t: to }; } },
            { label: "Últ. 90d", fn: () => { const t = new Date(); const d = new Date(t); d.setDate(t.getDate()-90); return { f: d.toISOString().slice(0,10), t: to }; } },
          ].map(({ label, fn }) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                const { f, t: tDate } = fn();
                const p = new URLSearchParams({ from: f, to: tDate });
                if (warehouseFilter) p.set("warehouse", warehouseFilter);
                router.push(`/dashboard/pos/ventas/productos?${p.toString()}`);
              }}
              className="h-7 rounded-sm border border-steel-700 px-2 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground hover:border-steel-600 hover:text-foreground transition-colors"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Warehouse filter */}
        {warehouses.length > 1 ? (
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/60 mb-1">Bodega</p>
            <select
              value={warehouseFilter ?? ""}
              onChange={(e) => applyWarehouse(e.target.value)}
              className="rounded-sm border border-steel-700 bg-steel-900 px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
            >
              <option value="">Todas las bodegas</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────── */}
      {rows.length > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard label="Ingresos brutos"      value={moneyFmt.format(kpis.total_gross)}  accent />
            <KpiCard label="Ingreso neto (s/IVA)" value={moneyFmt.format(kpis.total_net)} />
            <KpiCard label="Ganancia estimada"    value={moneyFmt.format(kpis.total_profit)} />
            <KpiCard label="Margen promedio"      value={pctFmt.format(kpis.avg_margin / 100)} />
            <KpiCard label="Unidades vendidas"    value={numFmt.format(kpis.total_units)} />
            <KpiCard label="Productos distintos"  value={String(kpis.distinct_products)} />
          </div>

          {/* Top 5 */}
          <div className="rounded-sm border border-steel-700 bg-steel-900/40 px-4 py-3">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60 mb-2">
              Top 5 · más ingresos
            </p>
            <div className="flex flex-wrap gap-2">
              {kpis.top5.map((r, i) => (
                <div
                  key={r.product_id ?? r.name}
                  className="flex items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-900/60 px-3 py-1.5"
                >
                  <span className="font-mono text-[9px] font-bold text-safety-500">#{i + 1}</span>
                  <span className="font-medium text-[11px] text-foreground">{r.name}</span>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
                    {moneyFmt.format(r.gross_billed)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Controls ─────────────────────────────────────────────────── */}
      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* Sort mode */}
          <div className="flex gap-1 flex-wrap">
            {(Object.entries(SORT_LABELS) as [SortMode, string][]).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSortMode(mode)}
                className={[
                  "h-7 rounded-sm border px-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] transition-colors",
                  sortMode === mode
                    ? "border-safety-500 bg-safety-500/10 text-safety-500"
                    : "border-steel-700 text-muted-foreground hover:border-steel-600 hover:text-foreground",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o SKU..."
              className="h-8 pl-9 text-[12px]"
            />
          </div>

          {/* CSV export */}
          <button
            type="button"
            onClick={() => downloadCsv(filtered, from, to)}
            className="flex h-8 items-center gap-1.5 rounded-sm border border-steel-700 px-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 hover:border-steel-600 hover:text-foreground transition-colors"
          >
            <DownloadIcon className="h-3 w-3" />
            CSV
          </button>
        </div>
      ) : null}

      {/* ── Empty state ──────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-sm border border-steel-700 py-14 text-center">
          <BoxIcon className="h-9 w-9 text-muted-foreground/30" />
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Sin ventas en este período
          </p>
          <p className="font-mono text-[10px] text-muted-foreground/50">
            {fmtDate(from)} — {fmtDate(to)}
          </p>
          <Link
            href="/dashboard/pos"
            className="font-mono text-[10px] uppercase tracking-[0.1em] text-safety-500/70 hover:text-safety-500 transition-colors"
          >
            Ir al terminal →
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center font-mono text-[11px] text-muted-foreground">
          Sin resultados para &quot;{search}&quot;
        </p>
      ) : null}

      {/* ── Desktop table ─────────────────────────────────────────────── */}
      {filtered.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-sm border border-steel-700 sm:block">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b-2 border-steel-700 bg-steel-900/70">
                  {[
                    { h: "Producto",     cls: "" },
                    { h: "Unidades",     cls: "text-right" },
                    { h: "Ingr. bruto",  cls: "text-right" },
                    { h: "Descuento",    cls: "text-right" },
                    { h: "IVA",          cls: "text-right" },
                    { h: "Ingr. neto",   cls: "text-right" },
                    { h: "Costo est.",   cls: "text-right" },
                    { h: "Ganancia",     cls: "text-right" },
                    { h: "Margen",       cls: "text-right" },
                    { h: "Última venta", cls: "" },
                    { h: "",             cls: "" },
                  ].map(({ h, cls }) => (
                    <th
                      key={h}
                      className={`px-3 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60 ${cls}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-800/50">
                {filtered.map((row) => {
                  const key      = rowKey(row);
                  const isOpen   = expanded.has(key);
                  const hasNoCost = row.cost_source === "zero";
                  return (
                    <React.Fragment key={key}>
                      <tr className="hover:bg-steel-800/30">
                        <td className="px-3 py-3">
                          <div className="font-semibold text-foreground leading-snug">{row.name}</div>
                          <div className="font-mono text-[9.5px] text-muted-foreground/50 leading-snug">
                            {row.sku !== "—" ? row.sku : ""}
                            {row.sku !== "—" && row.unit ? " · " : ""}
                            {row.unit}
                            {row.qty_returned > 0 ? (
                              <span className="ml-1.5 text-signal-400/70">
                                ↩ {numFmt.format(row.qty_returned)} dev.
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums font-bold text-foreground">
                          {numFmt.format(row.qty_net)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">
                          {moneyFmt.format(row.gross_billed)}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {row.total_discount > 0 ? `−${moneyFmt.format(row.total_discount)}` : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {row.total_iva > 0 ? moneyFmt.format(row.total_iva) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-safety-500 font-bold">
                          {moneyFmt.format(row.net_revenue)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {hasNoCost ? (
                            <span className="font-mono text-[10px] text-muted-foreground/30">—</span>
                          ) : (
                            <div>
                              <span className="font-mono tabular-nums text-muted-foreground">
                                {moneyFmt.format(row.cost_estimate)}
                              </span>
                              <div className={`font-mono text-[8.5px] ${COST_SOURCE_COLORS[row.cost_source]}`}>
                                {COST_SOURCE_LABELS[row.cost_source]}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {hasNoCost ? (
                            <span className="font-mono text-[10px] text-muted-foreground/30">—</span>
                          ) : (
                            <span className={`font-mono tabular-nums font-bold ${row.gross_profit >= 0 ? "text-signal-400" : "text-red-400"}`}>
                              {moneyFmt.format(row.gross_profit)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {hasNoCost ? (
                            <span className="font-mono text-[10px] text-muted-foreground/30">—</span>
                          ) : (
                            <span className={`font-mono tabular-nums font-bold text-[11px] ${marginClass(row.margin_pct)}`}>
                              {pctFmt.format(row.margin_pct / 100)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
                          {fmtDate(row.last_sale_date)}
                          <div className="text-[9px] text-muted-foreground/40">
                            {row.sale_count} venta{row.sale_count !== 1 ? "s" : ""}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => toggleDrill(key)}
                            className={[
                              "flex h-6 items-center gap-0.5 rounded-sm border px-1.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] transition-colors",
                              isOpen
                                ? "border-safety-500/50 bg-safety-500/10 text-safety-500"
                                : "border-steel-700 text-muted-foreground/50 hover:border-steel-600 hover:text-foreground",
                            ].join(" ")}
                          >
                            <ChevronIcon open={isOpen} />
                            Detalle
                          </button>
                        </td>
                      </tr>

                      {/* ── Drill-down ─────────────────────────────── */}
                      {isOpen ? (
                        <tr>
                          <td colSpan={11} className="px-4 pb-3 pt-1 bg-steel-950/40">
                            <DrillTable items={row.drill} unit={row.unit} />
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ─────────────────────────────────────────── */}
          <div className="space-y-2 sm:hidden">
            {filtered.map((row) => {
              const key    = rowKey(row);
              const isOpen = expanded.has(key);
              return (
                <div key={key} className="rounded-sm border border-steel-700 overflow-hidden">
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-foreground">{row.name}</p>
                        <p className="font-mono text-[9.5px] text-muted-foreground/50">
                          {row.sku !== "—" ? row.sku : ""}{row.unit ? ` · ${row.unit}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-display text-[18px] leading-none text-safety-500">
                          {moneyFmt.format(row.gross_billed)}
                        </p>
                        <p className="font-mono text-[9px] text-muted-foreground/50">
                          {numFmt.format(row.qty_net)} {row.unit}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {row.cost_source !== "zero" ? (
                        <>
                          <MobileKpi label="Neto" value={moneyFmt.format(row.net_revenue)} />
                          <MobileKpi label="Ganancia" value={moneyFmt.format(row.gross_profit)} />
                          <MobileKpi label="Margen" value={pctFmt.format(row.margin_pct / 100)} />
                        </>
                      ) : null}
                      <MobileKpi label="Última venta" value={fmtDate(row.last_sale_date)} />
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleDrill(key)}
                      className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground/50 hover:text-foreground transition-colors"
                    >
                      {isOpen ? "▲ Ocultar detalle" : "▼ Ver detalle"}
                    </button>
                  </div>
                  {isOpen ? (
                    <div className="border-t border-steel-800/50 bg-steel-950/40 px-4 py-3">
                      <DrillTable items={row.drill} unit={row.unit} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <p className="font-mono text-[11px] text-muted-foreground/50">
            {filtered.length} de {rows.length} producto{rows.length !== 1 ? "s" : ""}
            {" · "}
            {kpis.total_sales} venta{kpis.total_sales !== 1 ? "s" : ""} en el período
          </p>
        </>
      ) : null}
    </div>
  );
}

// ── Drill-down table ───────────────────────────────────────────────────────

function DrillTable({ items, unit }: { items: DrillItem[]; unit: string }) {
  if (!items.length) return null;
  return (
    <div className="overflow-x-auto">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/50 mb-1.5">
        Ventas donde aparece este producto
      </p>
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="border-b border-steel-700/50">
            {["Fecha", "Cliente", "Cant.", "P. unitario", "Total"].map((h) => (
              <th key={h} className="pb-1 pr-4 text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/50 last:pr-0">
                {h}
              </th>
            ))}
            <th className="pb-1 pl-2 text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/50"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-steel-800/20">
          {items.map((d, i) => (
            <tr key={`${d.sale_id}-${i}`} className={d.net_refund > 0 ? "opacity-60" : ""}>
              <td className="py-1 pr-4 font-mono tabular-nums text-muted-foreground">{fmtDate(d.sale_date)}</td>
              <td className="py-1 pr-4 text-foreground/80 max-w-[140px] truncate">{d.customer_name}</td>
              <td className="py-1 pr-4 font-mono tabular-nums text-muted-foreground">{d.qty} {unit}</td>
              <td className="py-1 pr-4 font-mono tabular-nums text-muted-foreground">{moneyFmt.format(d.unit_price)}</td>
              <td className="py-1 font-mono tabular-nums font-bold text-foreground">
                {moneyFmt.format(d.gross)}
                {d.net_refund > 0 ? (
                  <span className="ml-1 font-mono text-[9px] text-signal-400/70">
                    ↩ dev.
                  </span>
                ) : null}
              </td>
              <td className="py-1 pl-2">
                <Link
                  href={`/dashboard/pos/ventas/${d.sale_id}`}
                  className="font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground/40 hover:text-foreground transition-colors"
                >
                  Ver →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">{label}</p>
      <p className={`mt-0.5 font-display text-[22px] leading-none tabular-nums ${accent ? "text-safety-500" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function MobileKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-steel-800/60 px-2 py-1">
      <p className="font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground/50">{label}</p>
      <p className="font-mono text-[11px] tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-90" : ""}`}
      fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
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

function BoxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}
