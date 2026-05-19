"use client";
import { downloadCsvFile } from "@/lib/export/format";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { todayEC } from "@/lib/date-ec";

// ── Types ─────────────────────────────────────────────────────────────────────

export type IvaRow = {
  id:               string;
  display_date:     string;   // purchase_date ?? created_at.slice(0,10)
  created_at:       string;
  document_ref:     string | null;  // notes or document_number
  supplier_id:      string | null;
  supplier_name:    string;
  supplier_ruc:     string | null;
  subtotal:         number;   // neto s/IVA
  tax_total:        number;   // IVA
  total:            number;   // total c/IVA
  other_charges:    number;
  tax_rate:         number;   // e.g. 15 or 0
  is_tax_inclusive: boolean;  // how the user entered prices (informativo)
};

type RateAgg = {
  rate:     number;
  subtotal: number;
  tax:      number;
  total:    number;
  count:    number;
};

type Props = {
  rows:               IvaRow[];
  from:               string;
  to:                 string;
  totalSubtotal:      number;
  totalTax:           number;
  totalGrand:         number;
  totalOtherCharges:  number;
  count:              number;
  byRate:             RateAgg[];
};

// ── Formatters ────────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit", month: "short", year: "numeric",
});

// ── CSV ───────────────────────────────────────────────────────────────────────

function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  downloadCsvFile(filename, headers, rows);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function IvaReportTable({
  rows,
  from,
  to,
  totalSubtotal,
  totalTax,
  totalGrand,
  totalOtherCharges,
  count,
  byRate,
}: Props) {
  const router = useRouter();
  const [fromInput, setFromInput] = React.useState(from);
  const [toInput,   setToInput]   = React.useState(to);

  const applyFilter = () => {
    if (!fromInput || !toInput) return;
    router.push(`/dashboard/compras/iva?from=${fromInput}&to=${toInput}`, { scroll: false });
  };

  // ── KPI computation ──────────────────────────────────────────────────────
  const taxRate15    = byRate.find((r) => r.rate === 15);
  const taxRate12    = byRate.find((r) => r.rate === 12);
  const taxRateOther = byRate.filter((r) => r.rate !== 15 && r.rate !== 12 && r.rate > 0);
  const taxRateZero  = byRate.find((r) => r.rate === 0);

  // ── By supplier ──────────────────────────────────────────────────────────
  type SupAgg = { name: string; ruc: string | null; subtotal: number; tax: number; total: number; count: number };
  const supMap = React.useMemo(() => {
    const m = new Map<string, SupAgg>();
    for (const r of rows) {
      const key = r.supplier_id ?? "__none__";
      const acc = m.get(key) ?? { name: r.supplier_name, ruc: r.supplier_ruc, subtotal: 0, tax: 0, total: 0, count: 0 };
      acc.subtotal += r.subtotal;
      acc.tax      += r.tax_total;
      acc.total    += r.total;
      acc.count    += 1;
      m.set(key, acc);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  const exportCsv = () => {
    const today = todayEC();
    downloadCsv(
      `iva_compras_${from}_${to}.csv`,
      ["Fecha", "Ref_Documento", "Proveedor", "RUC_CI_Proveedor", "Subtotal_Neto",
       "IVA", "Tasa_IVA_%", "Otros_Cargos", "Total_cIVA", "Modo_Ingreso"],
      rows.map((r) => [
        r.display_date,
        r.document_ref ?? "",
        r.supplier_name,
        r.supplier_ruc ?? "",
        r.subtotal.toFixed(2),
        r.tax_total.toFixed(2),
        String(r.tax_rate),
        r.other_charges.toFixed(2),
        r.total.toFixed(2),
        r.is_tax_inclusive ? "con IVA" : "sin IVA",
      ])
    );
    void today; // suppress unused warning
  };

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
          <Button
            type="button"
            size="md"
            onClick={applyFilter}
            className="sm:self-end"
          >
            Aplicar
          </Button>
          {rows.length > 0 ? (
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
            {from} → {to} · {count} compra{count !== 1 ? "s" : ""} recibida{count !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="panel rounded-sm px-6 py-12 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            Sin compras recibidas en el período seleccionado.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI cards ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Subtotal neto"   value={moneyFmt.format(totalSubtotal)} sub="s/IVA" />
            <KpiCard label="IVA compras"     value={moneyFmt.format(totalTax)}      sub="total período" warn />
            <KpiCard label="Total facturado" value={moneyFmt.format(totalGrand)}    sub="c/IVA" highlight />
            <KpiCard label="Documentos"      value={String(count)}                  sub="compras recibidas" />
          </div>

          {/* ── Desglose por tasa de IVA ────────────────────────────── */}
          <section className="panel rounded-sm">
            <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
              <h2 className="font-display text-[16px] tracking-[0.04em]">DESGLOSE POR TASA</h2>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-steel-800 bg-steel-950/40">
                  <tr>
                    <Th>Tasa IVA</Th>
                    <Th className="text-right">Documentos</Th>
                    <Th className="text-right">Subtotal neto</Th>
                    <Th className="text-right">IVA</Th>
                    <Th className="text-right">Total c/IVA</Th>
                    <Th className="text-right">% del total IVA</Th>
                  </tr>
                </thead>
                <tbody>
                  {byRate.map((r) => {
                    const ivaPct = totalTax > 0 ? (r.tax / totalTax) * 100 : 0;
                    return (
                      <tr key={r.rate} className="border-b border-steel-800/50 hover:bg-steel-900/40">
                        <Td>
                          <span className={[
                            "font-mono text-[13px] font-bold",
                            r.rate === 0 ? "text-muted-foreground/60" : "text-foreground",
                          ].join(" ")}>
                            {r.rate === 0 ? "Exento (0%)" : `${r.rate}%`}
                          </span>
                        </Td>
                        <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">{r.count}</Td>
                        <Td className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">{moneyFmt.format(r.subtotal)}</Td>
                        <Td className="text-right font-mono text-[14px] font-bold tabular-nums text-foreground">{moneyFmt.format(r.tax)}</Td>
                        <Td className="text-right font-mono text-[13px] tabular-nums text-safety-500">{moneyFmt.format(r.total)}</Td>
                        <Td className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-steel-800">
                              <div
                                className="h-full rounded-full bg-safety-500/55"
                                style={{ width: `${Math.min(100, ivaPct).toFixed(1)}%` }}
                              />
                            </div>
                            <span className="w-10 font-mono text-[10px] tabular-nums text-muted-foreground/60">
                              {ivaPct.toFixed(1)}%
                            </span>
                          </div>
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
                    <td className="px-5 py-2.5 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{count}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-[13px] font-bold tabular-nums text-muted-foreground">{moneyFmt.format(totalSubtotal)}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-[14px] font-bold tabular-nums text-foreground">{moneyFmt.format(totalTax)}</td>
                    <td className="px-5 py-2.5 text-right font-mono text-[14px] font-bold tabular-nums text-safety-500">{moneyFmt.format(totalGrand)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* ── Desglose por proveedor ──────────────────────────────── */}
          {supMap.length > 1 ? (
            <section className="panel rounded-sm">
              <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
                <h2 className="font-display text-[16px] tracking-[0.04em]">POR PROVEEDOR</h2>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-b border-steel-800 bg-steel-950/40">
                    <tr>
                      <Th>Proveedor</Th>
                      <Th className="text-right">Docs</Th>
                      <Th className="text-right">Subtotal neto</Th>
                      <Th className="text-right">IVA</Th>
                      <Th className="text-right">Total c/IVA</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {supMap.map((s, idx) => (
                      <tr key={idx} className="border-b border-steel-800/50 hover:bg-steel-900/40">
                        <Td>
                          <div className="font-semibold text-foreground">{s.name}</div>
                          {s.ruc ? (
                            <div className="font-mono text-[10px] text-muted-foreground/60">{s.ruc}</div>
                          ) : null}
                        </Td>
                        <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">{s.count}</Td>
                        <Td className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">{moneyFmt.format(s.subtotal)}</Td>
                        <Td className="text-right font-mono text-[13px] font-bold tabular-nums text-foreground">{moneyFmt.format(s.tax)}</Td>
                        <Td className="text-right font-mono text-[13px] tabular-nums text-safety-500">{moneyFmt.format(s.total)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* ── Tabla de documentos ─────────────────────────────────── */}
          <section className="panel rounded-sm">
            <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
              <h2 className="font-display text-[16px] tracking-[0.04em]">DOCUMENTOS</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                {count} recibida{count !== 1 ? "s" : ""}
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[750px] text-left">
                <thead className="border-b border-steel-800 bg-steel-950/40">
                  <tr>
                    <Th>Fecha</Th>
                    <Th>Proveedor</Th>
                    <Th>Ref. documento</Th>
                    <Th className="text-right">Neto s/IVA</Th>
                    <Th className="text-right">IVA</Th>
                    <Th className="text-right">Total c/IVA</Th>
                    <Th className="text-right">Tasa</Th>
                    <Th>Modo</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-steel-800/50 transition-colors hover:bg-steel-900/40">
                      <Td className="whitespace-nowrap">
                        <span className="font-mono text-[11.5px] tabular-nums text-foreground">
                          {dateFmt.format(new Date(r.display_date + "T00:00:00"))}
                        </span>
                      </Td>
                      <Td>
                        <div className="font-semibold text-[13px] text-foreground">{r.supplier_name}</div>
                        {r.supplier_ruc ? (
                          <div className="font-mono text-[10px] text-muted-foreground/60">{r.supplier_ruc}</div>
                        ) : null}
                      </Td>
                      <Td>
                        {r.document_ref ? (
                          <span className="text-[12px] text-muted-foreground">{r.document_ref}</span>
                        ) : (
                          <span className="text-muted-foreground/35">—</span>
                        )}
                      </Td>
                      <Td className="text-right font-mono text-[12.5px] tabular-nums text-muted-foreground">
                        {moneyFmt.format(r.subtotal)}
                      </Td>
                      <Td className="text-right font-mono text-[13px] font-bold tabular-nums text-foreground">
                        {moneyFmt.format(r.tax_total)}
                      </Td>
                      <Td className="text-right font-mono text-[13px] tabular-nums text-safety-500">
                        {moneyFmt.format(r.total)}
                      </Td>
                      <Td className="text-right">
                        <span className={[
                          "rounded-sm border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em]",
                          r.tax_rate === 0
                            ? "border-steel-600 text-muted-foreground/50"
                            : "border-signal-600/50 bg-signal-700/10 text-signal-400",
                        ].join(" ")}>
                          {r.tax_rate === 0 ? "Exento" : `${r.tax_rate}%`}
                        </span>
                      </Td>
                      <Td>
                        <span className={[
                          "font-mono text-[9.5px] uppercase tracking-[0.08em]",
                          r.is_tax_inclusive ? "text-muted-foreground/50" : "text-muted-foreground/50",
                        ].join(" ")}>
                          {r.is_tax_inclusive ? "c/IVA" : "s/IVA"}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals footer */}
                <tfoot>
                  <tr className="border-t-2 border-steel-700 bg-steel-950/60">
                    <td colSpan={3} className="px-5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                      Totales del período
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-[13px] font-bold tabular-nums text-muted-foreground">
                      {moneyFmt.format(totalSubtotal)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-[14px] font-bold tabular-nums text-foreground">
                      {moneyFmt.format(totalTax)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-[15px] font-bold tabular-nums text-safety-500">
                      {moneyFmt.format(totalGrand)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Other charges footnote */}
          {totalOtherCharges > 0 ? (
            <p className="px-1 font-mono text-[10px] text-muted-foreground/50">
              * Otros cargos incluidos en el total: {moneyFmt.format(totalOtherCharges)} (ecovalor, fletes).
              Excluidos del subtotal neto e IVA.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  highlight,
  warn,
}: {
  label:      string;
  value:      string;
  sub?:       string;
  highlight?: boolean;
  warn?:      boolean;
}) {
  return (
    <div className={["panel rounded-sm px-4 py-3.5", highlight ? "border-safety-500/50" : ""].join(" ")}>
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </div>
      <div className={[
        "mt-1 font-mono text-[19px] font-bold tabular-nums sm:text-[21px]",
        highlight ? "text-safety-500" : warn ? "text-signal-400" : "text-foreground",
      ].join(" ")}>
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/50">
          {sub}
        </div>
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
