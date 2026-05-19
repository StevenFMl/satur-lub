"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MonthData = {
  yearMonth:              string;  // "2026-01" or year for totals
  label:                  string;  // "Ene 2026" | "Q1 2026" | "Total 2026"
  // Ventas
  subtotalVentas:         number;
  ivaVentas:              number;
  totalVentas:            number;
  countVentas:            number;
  // Compras
  subtotalCompras:        number;
  ivaCompras:             number;
  totalCompras:           number;
  countCompras:           number;
  // Form 104 base — ventas split (approximation: tax_total>0 ⟹ gravada)
  subtotalVentasGravadas: number;
  ivaVentasGravadas:      number;
  subtotalVentasExentas:  number;
  ivaVentasExentas:       number;
  // Form 104 base — compras split by tax_rate
  subtotalCompras15:      number;
  ivaCompras15:           number;
  subtotalCompras0:       number;
  ivaCompras0:            number;
};

type Props = {
  year:    string;
  months:  MonthData[];  // always 12 items (Jan-Dec)
  totales: MonthData;
};

type Mode = "monthly" | "quarterly";

// ── Formatters ────────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

// "compact" notation removed — financial summaries must show full amounts
// ($1.200,25, not "$1.2k"). Use same formatter as the rest of the app.
const moneyShort = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

// ── CSV ───────────────────────────────────────────────────────────────────────

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

// ── Quarterly merge ───────────────────────────────────────────────────────────

function toQuarters(months: MonthData[], year: string): MonthData[] {
  const Q_LABELS = ["Q1", "Q2", "Q3", "Q4"];
  const quarters: MonthData[] = [];
  for (let q = 0; q < 4; q++) {
    const slice = months.slice(q * 3, q * 3 + 3);
    const label = `${Q_LABELS[q]} ${year}`;
    quarters.push({
      yearMonth:              `${year}-Q${q + 1}`,
      label,
      subtotalVentas:         slice.reduce((s, m) => s + m.subtotalVentas, 0),
      ivaVentas:              slice.reduce((s, m) => s + m.ivaVentas, 0),
      totalVentas:            slice.reduce((s, m) => s + m.totalVentas, 0),
      countVentas:            slice.reduce((s, m) => s + m.countVentas, 0),
      subtotalCompras:        slice.reduce((s, m) => s + m.subtotalCompras, 0),
      ivaCompras:             slice.reduce((s, m) => s + m.ivaCompras, 0),
      totalCompras:           slice.reduce((s, m) => s + m.totalCompras, 0),
      countCompras:           slice.reduce((s, m) => s + m.countCompras, 0),
      subtotalVentasGravadas: slice.reduce((s, m) => s + m.subtotalVentasGravadas, 0),
      ivaVentasGravadas:      slice.reduce((s, m) => s + m.ivaVentasGravadas, 0),
      subtotalVentasExentas:  slice.reduce((s, m) => s + m.subtotalVentasExentas, 0),
      ivaVentasExentas:       0,
      subtotalCompras15:      slice.reduce((s, m) => s + m.subtotalCompras15, 0),
      ivaCompras15:           slice.reduce((s, m) => s + m.ivaCompras15, 0),
      subtotalCompras0:       slice.reduce((s, m) => s + m.subtotalCompras0, 0),
      ivaCompras0:            0,
    });
  }
  return quarters;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ConsolidadoTable({ year, months, totales }: Props) {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("monthly");

  const yearNum     = Number(year);
  const prevYear    = String(yearNum - 1);
  const nextYear    = String(yearNum + 1);
  const currentYear = String(new Date().getFullYear());

  const rows = mode === "monthly" ? months : toQuarters(months, year);

  // Max IVA neto for bar scaling
  const maxAbsNeto = React.useMemo(
    () => Math.max(1, ...rows.map((r) => Math.abs(r.ivaVentas - r.ivaCompras))),
    [rows]
  );

  const exportConsolidado = () => {
    downloadCsv(
      `consolidado_iva_${year}_${mode}.csv`,
      ["Período",
       "Ventas_Docs", "Base_Ventas_Neta", "IVA_Ventas",
       "Compras_Docs", "Base_Compras_Neta", "IVA_Compras",
       "IVA_Neto", "Estado"],
      [...rows, totales].map((r) => {
        const neto   = r.ivaVentas - r.ivaCompras;
        const estado = neto > 0.005 ? "Por declarar" : neto < -0.005 ? "A favor" : "Equilibrado";
        return [
          r.label,
          String(r.countVentas),
          r.subtotalVentas.toFixed(2),
          r.ivaVentas.toFixed(2),
          String(r.countCompras),
          r.subtotalCompras.toFixed(2),
          r.ivaCompras.toFixed(2),
          neto.toFixed(2),
          estado,
        ];
      })
    );
  };

  // Form 104 export — one row per period, aligned to SRI form structure
  const exportForm104 = () => {
    downloadCsv(
      `form104_base_${year}_${mode}.csv`,
      ["Período",
       // Ventas
       "411_Base_Ventas_Gravadas_15pct",
       "421_IVA_Ventas_15pct",
       "415_Base_Ventas_Exentas_0pct",
       // Compras
       "500_Base_Compras_Gravadas_15pct",
       "563_IVA_Compras_Deducible_15pct",
       "505_Base_Compras_0pct",
       // Resultado
       "IVA_Neto",
       "Estado",
       "Notas"],
      [...rows, totales].map((r) => {
        const neto   = r.ivaVentas - r.ivaCompras;
        const estado = neto > 0.005 ? "Por declarar" : neto < -0.005 ? "A favor" : "Equilibrado";
        return [
          r.label,
          r.subtotalVentasGravadas.toFixed(2),
          r.ivaVentasGravadas.toFixed(2),
          r.subtotalVentasExentas.toFixed(2),
          r.subtotalCompras15.toFixed(2),
          r.ivaCompras15.toFixed(2),
          r.subtotalCompras0.toFixed(2),
          neto.toFixed(2),
          estado,
          "Ventas exentas=aprox (ventas con IVA=0). Verificar con contabilidad.",
        ];
      })
    );
  };

  const hasAnyData = totales.countVentas > 0 || totales.countCompras > 0;

  return (
    <div className="space-y-6">

      {/* ── Controls bar ────────────────────────────────────────────────── */}
      <div className="panel rounded-sm">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">

          {/* Year navigator */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => router.push(`/dashboard/compras/consolidado?year=${prevYear}`, { scroll: false })}
              className="grid h-9 w-9 place-items-center rounded-sm border border-steel-700 bg-steel-800 font-mono text-[13px] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
              aria-label={`Año anterior (${prevYear})`}
            >
              ‹
            </button>
            <div className="min-w-[72px] rounded-sm border border-steel-700 bg-steel-800 px-3 py-1.5 text-center font-mono text-[15px] font-bold text-foreground">
              {year}
            </div>
            <button
              type="button"
              onClick={() => router.push(`/dashboard/compras/consolidado?year=${nextYear}`, { scroll: false })}
              disabled={nextYear > currentYear}
              className="grid h-9 w-9 place-items-center rounded-sm border border-steel-700 bg-steel-800 font-mono text-[13px] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`Año siguiente (${nextYear})`}
            >
              ›
            </button>
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-sm border border-steel-700 bg-steel-900">
            {(["monthly", "quarterly"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={[
                  "px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors",
                  mode === m
                    ? "bg-steel-700 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {m === "monthly" ? "Mensual" : "Trimestral"}
              </button>
            ))}
          </div>

          {/* Export buttons */}
          {hasAnyData ? (
            <>
              <button
                type="button"
                onClick={exportConsolidado}
                className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                CSV
              </button>
              <button
                type="button"
                onClick={exportForm104}
                className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-signal-700/50 bg-signal-900/20 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-signal-400/80 transition-colors hover:border-signal-600 hover:text-signal-400"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                Base 104
              </button>
            </>
          ) : null}
        </div>
        <div className="border-t border-steel-800/60 px-5 py-2">
          <p className="font-mono text-[10px] text-muted-foreground/50">
            {totales.countVentas} ventas confirmadas · {totales.countCompras} compras recibidas · año {year}
          </p>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {!hasAnyData ? (
        <div className="panel rounded-sm px-6 py-12 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            Sin movimientos fiscales en {year}.
          </p>
        </div>
      ) : (
        <>
          {/* ── Annual KPI summary ──────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard label="IVA Ventas"  value={moneyFmt.format(totales.ivaVentas)}   warn />
            <KpiCard label="IVA Compras" value={moneyFmt.format(totales.ivaCompras)}  sub="crédito tributario" />
            <KpiCard
              label="IVA Neto"
              value={`${totales.ivaVentas - totales.ivaCompras < 0 ? "−" : ""}${moneyFmt.format(Math.abs(totales.ivaVentas - totales.ivaCompras))}`}
              highlight={totales.ivaVentas - totales.ivaCompras < 0}
              warn={totales.ivaVentas - totales.ivaCompras > 0}
              sub={totales.ivaVentas - totales.ivaCompras > 0.005 ? "por declarar" : totales.ivaVentas - totales.ivaCompras < -0.005 ? "a favor" : "equilibrado"}
            />
            <KpiCard label="Total ventas"  value={moneyFmt.format(totales.totalVentas)}  />
            <KpiCard label="Total compras" value={moneyFmt.format(totales.totalCompras)} />
            <KpiCard label="Docs"
              value={`${totales.countVentas} / ${totales.countCompras}`}
              sub="ventas / compras"
            />
          </div>

          {/* ── Main table ──────────────────────────────────────────── */}
          <section className="panel rounded-sm">
            <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
              <h2 className="font-display text-[16px] tracking-[0.04em]">
                {mode === "monthly" ? "POR MES" : "POR TRIMESTRE"}
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                {year}
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left">
                <thead className="border-b border-steel-800 bg-steel-950/40">
                  <tr>
                    <Th>Período</Th>
                    <Th className="text-right">Base ventas</Th>
                    <Th className="text-right">IVA ventas</Th>
                    <Th className="text-right">Base compras</Th>
                    <Th className="text-right">IVA compras</Th>
                    <Th className="text-right">IVA neto</Th>
                    <Th className="w-28">Indicador</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const neto      = r.ivaVentas - r.ivaCompras;
                    const isEmpty   = r.countVentas === 0 && r.countCompras === 0;
                    const status    = neto > 0.005 ? "pagar" : neto < -0.005 ? "favor" : "equil";
                    const barPct    = Math.min(100, (Math.abs(neto) / maxAbsNeto) * 100);
                    return (
                      <tr
                        key={r.yearMonth}
                        className={[
                          "border-b border-steel-800/50 transition-colors",
                          isEmpty ? "opacity-35" : "hover:bg-steel-900/40",
                        ].join(" ")}
                      >
                        <Td>
                          <span className="font-mono text-[12.5px] font-semibold text-foreground">
                            {r.label}
                          </span>
                          {!isEmpty ? (
                            <span className="ml-2 font-mono text-[9px] text-muted-foreground/50">
                              {r.countVentas}v · {r.countCompras}c
                            </span>
                          ) : null}
                        </Td>
                        <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                          {isEmpty ? "—" : moneyShort.format(r.subtotalVentas)}
                        </Td>
                        <Td className="text-right font-mono text-[13px] tabular-nums text-foreground">
                          {isEmpty ? "—" : moneyFmt.format(r.ivaVentas)}
                        </Td>
                        <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                          {isEmpty ? "—" : moneyShort.format(r.subtotalCompras)}
                        </Td>
                        <Td className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                          {isEmpty ? "—" : moneyFmt.format(r.ivaCompras)}
                        </Td>
                        <Td className={[
                          "text-right font-mono text-[14px] font-bold tabular-nums",
                          isEmpty    ? "text-muted-foreground/30" :
                          status === "pagar" ? "text-signal-400" :
                          status === "favor" ? "text-safety-500" :
                                               "text-muted-foreground/50",
                        ].join(" ")}>
                          {isEmpty ? "—" : `${neto < 0 ? "−" : ""}${moneyFmt.format(Math.abs(neto))}`}
                        </Td>
                        <Td>
                          {!isEmpty ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-steel-800">
                                <div
                                  className={[
                                    "h-full rounded-full transition-all",
                                    status === "pagar" ? "bg-signal-500/60" :
                                    status === "favor" ? "bg-safety-500/60" :
                                                         "bg-steel-600",
                                  ].join(" ")}
                                  style={{ width: `${barPct.toFixed(1)}%` }}
                                />
                              </div>
                              <span className={[
                                "shrink-0 font-mono text-[8.5px] uppercase tracking-[0.08em]",
                                status === "pagar" ? "text-signal-400/70" :
                                status === "favor" ? "text-safety-500/70" :
                                                     "text-muted-foreground/40",
                              ].join(" ")}>
                                {status === "pagar" ? "Decl." : status === "favor" ? "Favor" : "0"}
                              </span>
                            </div>
                          ) : null}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-steel-700 bg-steel-950/60">
                    <td className="px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                      Total {year}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-[12px] font-bold tabular-nums text-muted-foreground">
                      {moneyShort.format(totales.subtotalVentas)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-[14px] font-bold tabular-nums text-foreground">
                      {moneyFmt.format(totales.ivaVentas)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-[12px] font-bold tabular-nums text-muted-foreground">
                      {moneyShort.format(totales.subtotalCompras)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-[14px] font-bold tabular-nums text-muted-foreground">
                      {moneyFmt.format(totales.ivaCompras)}
                    </td>
                    {(() => {
                      const neto   = totales.ivaVentas - totales.ivaCompras;
                      const status = neto > 0.005 ? "pagar" : neto < -0.005 ? "favor" : "equil";
                      return (
                        <td className={[
                          "px-5 py-3 text-right font-mono text-[15px] font-bold tabular-nums",
                          status === "pagar" ? "text-signal-400" :
                          status === "favor" ? "text-safety-500" :
                                               "text-muted-foreground/50",
                        ].join(" ")}>
                          {neto < 0 ? "−" : ""}{moneyFmt.format(Math.abs(neto))}
                        </td>
                      );
                    })()}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── Nota Form 104 ────────────────────────────────────────── */}
          <div className="panel rounded-sm border-l-2 border-signal-700/40 px-5 py-3.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-signal-400/70">
              Base Formulario 104 SRI
            </p>
            <p className="mt-1 font-mono text-[11px] leading-5 text-muted-foreground/60">
              Usar <strong className="text-muted-foreground">↓ Base 104</strong> para exportar la estructura alineada al formulario.
              Ventas exentas se aproximan como ventas con IVA = 0 en la cabecera del documento.
              Ventas con ítems mixtos (gravados + exentos en la misma factura) requieren verificación manual.
              IVA compras con tasa 0% incluye compras exentas y compras de proveedores del exterior.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, highlight, warn,
}: {
  label:      string;
  value:      string;
  sub?:       string;
  highlight?: boolean;
  warn?:      boolean;
}) {
  return (
    <div className={["panel rounded-sm px-4 py-3.5", highlight ? "border-safety-500/50" : ""].join(" ")}>
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">{label}</div>
      <div className={[
        "mt-1 font-mono text-[17px] font-bold tabular-nums sm:text-[19px]",
        highlight ? "text-safety-500" : warn ? "text-signal-400" : "text-foreground",
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
