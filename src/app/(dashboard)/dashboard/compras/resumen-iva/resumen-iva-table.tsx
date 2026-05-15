"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { RateAggCompras, RateAggVentas } from "./page";

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  from:             string;
  to:               string;
  // Ventas
  ivaVentas:        number;
  subtotalVentas:   number;
  totalVentas:      number;
  countVentas:      number;
  byRateVentas:     RateAggVentas[];
  // Compras
  ivaCompras:       number;
  subtotalCompras:  number;
  totalCompras:     number;
  countCompras:     number;
  byRateCompras:    RateAggCompras[];
};

// ── Formatters ────────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
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

// ── Component ─────────────────────────────────────────────────────────────────

export function ResumenIvaTable({
  from,
  to,
  ivaVentas,
  subtotalVentas,
  totalVentas,
  countVentas,
  byRateVentas,
  ivaCompras,
  subtotalCompras,
  totalCompras,
  countCompras,
  byRateCompras,
}: Props) {
  const router = useRouter();
  const [fromInput, setFromInput] = React.useState(from);
  const [toInput,   setToInput]   = React.useState(to);

  const applyFilter = () => {
    if (!fromInput || !toInput) return;
    router.push(`/dashboard/compras/resumen-iva?from=${fromInput}&to=${toInput}`, { scroll: false });
  };

  // ── IVA neto ─────────────────────────────────────────────────────────────
  const ivaNeto = ivaVentas - ivaCompras;
  const netStatus: "pagar" | "favor" | "equilibrado" =
    ivaNeto > 0.005 ? "pagar" : ivaNeto < -0.005 ? "favor" : "equilibrado";

  // ── Cross-rate table ─────────────────────────────────────────────────────
  const crossTable = React.useMemo(() => {
    const allRates = new Set<number>([
      ...byRateVentas.map((r) => r.rate),
      ...byRateCompras.map((r) => r.rate),
    ]);
    return Array.from(allRates)
      .sort((a, b) => b - a)
      .map((rate) => {
        const v = byRateVentas.find((r) => r.rate === rate);
        const c = byRateCompras.find((r) => r.rate === rate);
        const label = v?.label ?? (rate === 0 ? "Exento (0%)" : `${rate}%`);
        const taxV  = v?.tax ?? 0;
        const taxC  = c?.tax ?? 0;
        return { rate, label, taxVentas: taxV, taxCompras: taxC, neto: taxV - taxC };
      });
  }, [byRateVentas, byRateCompras]);

  const exportCsv = () => {
    downloadCsv(
      `resumen_iva_${from}_${to}.csv`,
      ["Tasa_IVA", "IVA_Ventas", "IVA_Compras", "IVA_Neto", "Estado"],
      [
        ...crossTable.map((r) => [
          r.label,
          r.taxVentas.toFixed(2),
          r.taxCompras.toFixed(2),
          r.neto.toFixed(2),
          r.neto > 0.005 ? "Por declarar" : r.neto < -0.005 ? "A favor" : "Equilibrado",
        ]),
        [
          "TOTAL",
          ivaVentas.toFixed(2),
          ivaCompras.toFixed(2),
          ivaNeto.toFixed(2),
          netStatus === "pagar" ? "Por declarar" : netStatus === "favor" ? "A favor" : "Equilibrado",
        ],
      ]
    );
  };

  const hasData = countVentas > 0 || countCompras > 0;

  return (
    <div className="space-y-6">

      {/* ── Date filter ─────────────────────────────────────────────────── */}
      <div className="panel rounded-sm">
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-end sm:gap-3">
          <div className="space-y-1">
            <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
              Desde
            </label>
            <Input
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              mono
              className="h-9 w-full sm:w-40"
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
              Hasta
            </label>
            <Input
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              mono
              className="h-9 w-full sm:w-40"
            />
          </div>
          <Button type="button" size="md" onClick={applyFilter} className="sm:self-end">
            Aplicar
          </Button>
          {hasData ? (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground sm:self-end"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              CSV
            </button>
          ) : null}
        </div>
        <div className="border-t border-steel-800/60 px-5 py-2">
          <p className="font-mono text-[10px] text-muted-foreground/50">
            {from} → {to} · {countVentas} venta{countVentas !== 1 ? "s" : ""} · {countCompras} compra{countCompras !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {!hasData ? (
        <div className="panel rounded-sm px-6 py-12 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            Sin movimientos fiscales en el período seleccionado.
          </p>
        </div>
      ) : (
        <>
          {/* ── IVA Neto hero ─────────────────────────────────────────── */}
          <section className={[
            "panel rounded-sm border-l-4",
            netStatus === "pagar"        ? "border-signal-500"  :
            netStatus === "favor"        ? "border-safety-500"  :
                                           "border-steel-600",
          ].join(" ")}>
            <div className="px-6 py-6 sm:px-8 sm:py-7">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
                    IVA Neto del período
                  </div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/40">
                    IVA ventas − IVA compras
                  </div>
                </div>
                <StatusBadge status={netStatus} />
              </div>

              <div className={[
                "font-display text-[48px] leading-none tracking-[0.01em] sm:text-[56px]",
                netStatus === "pagar" ? "text-signal-400"  :
                netStatus === "favor" ? "text-safety-500"  :
                                        "text-foreground",
              ].join(" ")}>
                {ivaNeto < 0 ? "−" : ""}{moneyFmt.format(Math.abs(ivaNeto))}
              </div>

              {netStatus !== "equilibrado" ? (
                <p className="mt-3 font-mono text-[11px] text-muted-foreground/60">
                  {netStatus === "pagar"
                    ? "Importe a declarar y pagar al SRI este período."
                    : "Crédito tributario a favor. Puede compensarse en períodos siguientes."}
                </p>
              ) : null}
            </div>
          </section>

          {/* ── Comparison blocks ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* IVA Ventas */}
            <div className="panel rounded-sm">
              <div className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-[14px] tracking-[0.06em] text-foreground">
                    IVA VENTAS
                  </h2>
                  <Link
                    href={`/dashboard/compras/iva-ventas?from=${from}&to=${to}`}
                    className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60 transition-colors hover:text-foreground"
                  >
                    Ver detalle →
                  </Link>
                </div>
              </div>
              <div className="space-y-3 px-5 py-4">
                <div className="flex items-end justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    IVA cobrado
                  </span>
                  <span className="font-mono text-[22px] font-bold tabular-nums text-foreground">
                    {moneyFmt.format(ivaVentas)}
                  </span>
                </div>
                <div className="space-y-1.5 border-t border-steel-800 pt-3">
                  <MetaRow label="Subtotal neto" value={moneyFmt.format(subtotalVentas)} />
                  <MetaRow label="Total c/IVA"   value={moneyFmt.format(totalVentas)}    />
                  <MetaRow label="Documentos"    value={String(countVentas)}              />
                </div>
                {byRateVentas.map((r) => (
                  <RateBar
                    key={r.label}
                    label={r.label}
                    tax={r.tax}
                    total={ivaVentas}
                  />
                ))}
              </div>
            </div>

            {/* IVA Compras */}
            <div className="panel rounded-sm">
              <div className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-[14px] tracking-[0.06em] text-foreground">
                    IVA COMPRAS
                  </h2>
                  <Link
                    href={`/dashboard/compras/iva?from=${from}&to=${to}`}
                    className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60 transition-colors hover:text-foreground"
                  >
                    Ver detalle →
                  </Link>
                </div>
              </div>
              <div className="space-y-3 px-5 py-4">
                <div className="flex items-end justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                    IVA pagado
                  </span>
                  <span className="font-mono text-[22px] font-bold tabular-nums text-foreground">
                    {moneyFmt.format(ivaCompras)}
                  </span>
                </div>
                <div className="space-y-1.5 border-t border-steel-800 pt-3">
                  <MetaRow label="Subtotal neto" value={moneyFmt.format(subtotalCompras)} />
                  <MetaRow label="Total c/IVA"   value={moneyFmt.format(totalCompras)}    />
                  <MetaRow label="Documentos"    value={String(countCompras)}              />
                </div>
                {byRateCompras.map((r) => (
                  <RateBar
                    key={r.rate}
                    label={r.rate === 0 ? "Exento (0%)" : `${r.rate}%`}
                    tax={r.tax}
                    total={ivaCompras}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* ── Cross-rate breakdown table ─────────────────────────── */}
          {crossTable.length > 0 ? (
            <section className="panel rounded-sm">
              <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
                <h2 className="font-display text-[16px] tracking-[0.04em]">DESGLOSE POR TASA</h2>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-b border-steel-800 bg-steel-950/40">
                    <tr>
                      <Th>Tasa IVA</Th>
                      <Th className="text-right">IVA Ventas</Th>
                      <Th className="text-right">IVA Compras</Th>
                      <Th className="text-right">IVA Neto</Th>
                      <Th className="text-right">Estado</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {crossTable.map((r) => {
                      const rowStatus: "pagar" | "favor" | "equilibrado" =
                        r.neto > 0.005 ? "pagar" : r.neto < -0.005 ? "favor" : "equilibrado";
                      return (
                        <tr key={r.label} className="border-b border-steel-800/50 hover:bg-steel-900/40">
                          <Td>
                            <span className={[
                              "font-mono text-[13px] font-bold",
                              r.rate === 0 ? "text-muted-foreground/60" : "text-foreground",
                            ].join(" ")}>
                              {r.label}
                            </span>
                          </Td>
                          <Td className="text-right font-mono text-[13px] tabular-nums text-foreground">
                            {moneyFmt.format(r.taxVentas)}
                          </Td>
                          <Td className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                            {moneyFmt.format(r.taxCompras)}
                          </Td>
                          <Td className={[
                            "text-right font-mono text-[14px] font-bold tabular-nums",
                            rowStatus === "pagar" ? "text-signal-400" :
                            rowStatus === "favor" ? "text-safety-500" :
                                                    "text-muted-foreground/60",
                          ].join(" ")}>
                            {r.neto < 0 ? "−" : ""}{moneyFmt.format(Math.abs(r.neto))}
                          </Td>
                          <Td className="text-right">
                            <StatusBadge status={rowStatus} small />
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-steel-700 bg-steel-950/60">
                      <td className="px-5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                        Total período
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-[14px] font-bold tabular-nums text-foreground">
                        {moneyFmt.format(ivaVentas)}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-[14px] font-bold tabular-nums text-muted-foreground">
                        {moneyFmt.format(ivaCompras)}
                      </td>
                      <td className={[
                        "px-5 py-2.5 text-right font-mono text-[15px] font-bold tabular-nums",
                        netStatus === "pagar" ? "text-signal-400" :
                        netStatus === "favor" ? "text-safety-500" :
                                                "text-muted-foreground/60",
                      ].join(" ")}>
                        {ivaNeto < 0 ? "−" : ""}{moneyFmt.format(Math.abs(ivaNeto))}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <StatusBadge status={netStatus} small />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status, small }: { status: "pagar" | "favor" | "equilibrado"; small?: boolean }) {
  const base = small
    ? "rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em]"
    : "rounded-sm border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em]";

  if (status === "pagar") {
    return (
      <span className={`${base} border-signal-600/50 bg-signal-700/10 text-signal-400`}>
        Por declarar
      </span>
    );
  }
  if (status === "favor") {
    return (
      <span className={`${base} border-safety-600/50 bg-safety-700/10 text-safety-500`}>
        A favor
      </span>
    );
  }
  return (
    <span className={`${base} border-steel-600 text-muted-foreground/50`}>
      Equilibrado
    </span>
  );
}

function RateBar({ label, tax, total }: { label: string; tax: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (tax / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/60">
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {tax.toFixed(2)}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-steel-800">
        <div
          className="h-full rounded-full bg-safety-500/45"
          style={{ width: `${pct.toFixed(2)}%` }}
        />
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/60">
        {label}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {value}
      </span>
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
