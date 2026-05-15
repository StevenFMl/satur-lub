"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SaleRow = {
  id:             string;
  display_date:   string;  // sale_date ?? created_at.slice(0,10)
  created_at:     string;
  document_kind:  string;  // 'invoice' | 'ticket' | 'quote' | 'note'
  customer_name:  string;
  customer_ruc:   string | null;
  subtotal:       number;  // neto s/IVA (from sales header)
  tax_total:      number;  // IVA (from sales header)
  total:          number;  // total c/IVA
  discount_total: number;
};

type RateAgg = {
  rate:  number;
  label: string;
  net:   number;
  tax:   number;
  gross: number;
};

type Props = {
  rows:          SaleRow[];
  from:          string;
  to:            string;
  kinds:         string;  // "all" | "invoice,ticket" | "invoice" | …
  totalSubtotal: number;
  totalTax:      number;
  totalGrand:    number;
  count:         number;
  byRate:        RateAgg[];
};

// Document kind options for the fiscal filter
const KIND_OPTIONS = [
  { value: "all",            label: "Todos"           },
  { value: "invoice,ticket", label: "Fiscal (F+T)"    },
  { value: "invoice",        label: "Solo Facturas"   },
] as const;

// ── Formatters ────────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit", month: "short", year: "numeric",
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function docKindLabel(kind: string): string {
  switch (kind) {
    case "invoice": return "Factura";
    case "ticket":  return "Ticket";
    case "quote":   return "Cotización";
    case "note":    return "Nota";
    default:        return kind;
  }
}

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

export function IvaVentasTable({
  rows,
  from,
  to,
  kinds,
  totalSubtotal,
  totalTax,
  totalGrand,
  count,
  byRate,
}: Props) {
  const router = useRouter();
  const [fromInput, setFromInput] = React.useState(from);
  const [toInput,   setToInput]   = React.useState(to);

  function buildUrl(newFrom: string, newTo: string, newKinds: string) {
    const params = new URLSearchParams({ from: newFrom, to: newTo });
    if (newKinds !== "all") params.set("kinds", newKinds);
    return `/dashboard/compras/iva-ventas?${params.toString()}`;
  }

  const applyFilter = () => {
    if (!fromInput || !toInput) return;
    router.push(buildUrl(fromInput, toInput, kinds), { scroll: false });
  };

  const applyKinds = (newKinds: string) => {
    router.push(buildUrl(fromInput, toInput, newKinds), { scroll: false });
  };

  // Human-readable description of active filter
  const kindsLabel = KIND_OPTIONS.find((o) => o.value === kinds)?.label ?? "Todos";

  // ── By customer ──────────────────────────────────────────────────────────
  type CustAgg = { name: string; ruc: string | null; subtotal: number; tax: number; total: number; count: number };
  const byCustomer = React.useMemo(() => {
    const m = new Map<string, CustAgg>();
    for (const r of rows) {
      const key = r.customer_name;
      const acc = m.get(key) ?? { name: r.customer_name, ruc: r.customer_ruc, subtotal: 0, tax: 0, total: 0, count: 0 };
      acc.subtotal += r.subtotal;
      acc.tax      += r.tax_total;
      acc.total    += r.total;
      acc.count    += 1;
      m.set(key, acc);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  const exportCsv = () => {
    downloadCsv(
      `iva_ventas_${from}_${to}.csv`,
      ["Fecha", "Tipo_Documento", "Cliente", "RUC_CI_Cliente",
       "Subtotal_Neto", "IVA", "Total_cIVA", "Descuento"],
      rows.map((r) => [
        r.display_date,
        docKindLabel(r.document_kind),
        r.customer_name,
        r.customer_ruc ?? "",
        r.subtotal.toFixed(2),
        r.tax_total.toFixed(2),
        r.total.toFixed(2),
        r.discount_total.toFixed(2),
      ])
    );
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
          <Button type="button" size="md" onClick={applyFilter} className="sm:self-end">
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
        {/* Document kind filter */}
        <div className="flex flex-wrap items-center gap-2 border-t border-steel-800/60 px-5 py-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/50">
            Tipo:
          </span>
          {KIND_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => applyKinds(opt.value)}
              className={[
                "rounded-sm border px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] transition-colors",
                kinds === opt.value
                  ? "border-safety-500/60 bg-safety-700/10 text-safety-500"
                  : "border-steel-700 text-muted-foreground/60 hover:border-steel-600 hover:text-foreground",
              ].join(" ")}
            >
              {opt.label}
            </button>
          ))}
          <span className="ml-auto font-mono text-[9px] text-muted-foreground/40">
            {from} → {to} · {count} {kindsLabel.toLowerCase()}
          </span>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="panel rounded-sm px-6 py-12 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            Sin ventas confirmadas en el período seleccionado.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI cards ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Subtotal neto"  value={moneyFmt.format(totalSubtotal)} sub="s/IVA" />
            <KpiCard label="IVA ventas"     value={moneyFmt.format(totalTax)}      sub="total período" warn />
            <KpiCard label="Total ventas"   value={moneyFmt.format(totalGrand)}    sub="c/IVA" highlight />
            <KpiCard label="Documentos"     value={String(count)}                  sub="ventas confirmadas" />
          </div>

          {/* ── Desglose por tasa ───────────────────────────────────── */}
          {byRate.length > 0 ? (
            <section className="panel rounded-sm">
              <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
                <h2 className="font-display text-[16px] tracking-[0.04em]">DESGLOSE POR TASA</h2>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-b border-steel-800 bg-steel-950/40">
                    <tr>
                      <Th>Tasa IVA</Th>
                      <Th className="text-right">Subtotal neto</Th>
                      <Th className="text-right">IVA</Th>
                      <Th className="text-right">Total c/IVA</Th>
                      <Th className="text-right">% del IVA total</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {byRate.map((r) => {
                      const ivaPct = totalTax > 0 ? (r.tax / totalTax) * 100 : 0;
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
                          <Td className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                            {moneyFmt.format(r.net)}
                          </Td>
                          <Td className="text-right font-mono text-[14px] font-bold tabular-nums text-foreground">
                            {moneyFmt.format(r.tax)}
                          </Td>
                          <Td className="text-right font-mono text-[13px] tabular-nums text-safety-500">
                            {moneyFmt.format(r.gross)}
                          </Td>
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
                      <td className="px-5 py-2.5 text-right font-mono text-[13px] font-bold tabular-nums text-muted-foreground">
                        {moneyFmt.format(totalSubtotal)}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-[14px] font-bold tabular-nums text-foreground">
                        {moneyFmt.format(totalTax)}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-[14px] font-bold tabular-nums text-safety-500">
                        {moneyFmt.format(totalGrand)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ) : null}

          {/* ── Desglose por cliente ─────────────────────────────────── */}
          {byCustomer.length > 1 ? (
            <section className="panel rounded-sm">
              <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
                <h2 className="font-display text-[16px] tracking-[0.04em]">POR CLIENTE</h2>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-b border-steel-800 bg-steel-950/40">
                    <tr>
                      <Th>Cliente</Th>
                      <Th className="text-right">Docs</Th>
                      <Th className="text-right">Subtotal neto</Th>
                      <Th className="text-right">IVA</Th>
                      <Th className="text-right">Total c/IVA</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCustomer.map((c, idx) => (
                      <tr key={idx} className="border-b border-steel-800/50 hover:bg-steel-900/40">
                        <Td>
                          <div className="font-semibold text-foreground">{c.name}</div>
                          {c.ruc ? (
                            <div className="font-mono text-[10px] text-muted-foreground/60">{c.ruc}</div>
                          ) : null}
                        </Td>
                        <Td className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                          {c.count}
                        </Td>
                        <Td className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                          {moneyFmt.format(c.subtotal)}
                        </Td>
                        <Td className="text-right font-mono text-[13px] font-bold tabular-nums text-foreground">
                          {moneyFmt.format(c.tax)}
                        </Td>
                        <Td className="text-right font-mono text-[13px] tabular-nums text-safety-500">
                          {moneyFmt.format(c.total)}
                        </Td>
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
                {count} confirmada{count !== 1 ? "s" : ""}
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left">
                <thead className="border-b border-steel-800 bg-steel-950/40">
                  <tr>
                    <Th>Fecha</Th>
                    <Th>Cliente</Th>
                    <Th>Tipo</Th>
                    <Th className="text-right">Neto s/IVA</Th>
                    <Th className="text-right">IVA</Th>
                    <Th className="text-right">Total c/IVA</Th>
                    <Th className="text-right">Descuento</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-steel-800/50 transition-colors hover:bg-steel-900/40"
                    >
                      <Td className="whitespace-nowrap">
                        <span className="font-mono text-[11.5px] tabular-nums text-foreground">
                          {dateFmt.format(new Date(r.display_date + "T00:00:00"))}
                        </span>
                      </Td>
                      <Td>
                        <div className="font-semibold text-[13px] text-foreground">{r.customer_name}</div>
                        {r.customer_ruc ? (
                          <div className="font-mono text-[10px] text-muted-foreground/60">{r.customer_ruc}</div>
                        ) : null}
                      </Td>
                      <Td>
                        <span className="rounded-sm border border-steel-600 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground/70">
                          {docKindLabel(r.document_kind)}
                        </span>
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
                      <Td className="text-right font-mono text-[11px] tabular-nums text-muted-foreground/60">
                        {r.discount_total > 0 ? moneyFmt.format(r.discount_total) : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
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
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
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
