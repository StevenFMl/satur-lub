"use client";
import { downloadCsvFile } from "@/lib/export/format";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditoriaRow = {
  id:            string;
  display_date:  string;
  created_at:    string;
  document_kind: string;
  customer_name: string;
  customer_ruc:  string | null;
  total:         number;
  subtotal:      number;
  loss_estimated: number;
  is_legacy:     boolean;  // true = backfilled; loss_estimated may be 0
  notes:         string | null;
};

export type TopProduct = {
  product_id: string;
  name:       string;
  sku:        string;
  sale_count: number;
};

type Props = {
  rows:           AuditoriaRow[];
  from:           string;
  to:             string;
  count:          number;
  totalLoss:      number;
  avgLoss:        number;
  totalSaleValue: number;
  topProducts:    TopProduct[];
};

// ── Formatters ────────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const dateFmt = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit", month: "short", year: "numeric",
});

function docLabel(k: string) {
  if (k === "invoice") return "Factura";
  if (k === "ticket")  return "Ticket";
  if (k === "quote")   return "Cotización";
  return k;
}

function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  downloadCsvFile(filename, headers, rows);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuditoriaTable({
  rows, from, to,
  count, totalLoss, avgLoss, totalSaleValue,
  topProducts,
}: Props) {
  const router = useRouter();
  const [fromInput, setFromInput] = React.useState(from);
  const [toInput,   setToInput]   = React.useState(to);

  const applyFilter = () => {
    if (!fromInput || !toInput) return;
    router.push(`/dashboard/pos/auditoria?from=${fromInput}&to=${toInput}`, { scroll: false });
  };

  const exportCsv = () => {
    downloadCsv(
      `auditoria_bajo_costo_${from}_${to}.csv`,
      ["Fecha", "ID_Venta", "Tipo", "Cliente", "RUC_CI",
       "Total_cIVA", "Pérdida_Estimada", "Notas", "Registro"],
      rows.map((r) => [
        r.display_date,
        r.id.slice(0, 8).toUpperCase(),
        docLabel(r.document_kind),
        r.customer_name,
        r.customer_ruc ?? "",
        r.total.toFixed(2),
        r.loss_estimated > 0 ? r.loss_estimated.toFixed(2) : "",
        r.notes ?? "",
        r.is_legacy ? "Legado (sin monto)" : "v18",
      ])
    );
  };

  return (
    <div className="space-y-6">

      {/* ── Date filter ─────────────────────────────────────────────────── */}
      <div className="panel rounded-sm">
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="space-y-1">
            <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
              Desde
            </label>
            <Input type="date" value={fromInput} onChange={(e) => setFromInput(e.target.value)}
              mono className="h-9 w-full sm:w-40" />
          </div>
          <div className="space-y-1">
            <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
              Hasta
            </label>
            <Input type="date" value={toInput} onChange={(e) => setToInput(e.target.value)}
              mono className="h-9 w-full sm:w-40" />
          </div>
          <Button type="button" size="md" onClick={applyFilter}>Aplicar</Button>
          {rows.length > 0 ? (
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              CSV
            </button>
          ) : null}
        </div>
        <div className="border-t border-steel-800/60 px-5 py-2">
          <p className="font-mono text-[10px] text-muted-foreground/50">
            {from} → {to} · {count} venta{count !== 1 ? "s" : ""} bajo costo
          </p>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="panel rounded-sm px-6 py-12 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            Sin ventas bajo costo en el período seleccionado.
          </p>
        </div>
      ) : (
        <>
          {/* ── KPI cards ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Overrides"       value={String(count)}               sub="ventas confirmadas" danger={count > 0} />
            <KpiCard label="Pérdida total"   value={moneyFmt.format(totalLoss)}  sub="estimada (CPP)" danger={totalLoss > 0} />
            <KpiCard label="Pérdida promedio" value={moneyFmt.format(avgLoss)}   sub="por venta" />
            <KpiCard label="Valor total"     value={moneyFmt.format(totalSaleValue)} sub="ventas bajo costo" />
          </div>

          {/* ── Top products ─────────────────────────────────────────────── */}
          {topProducts.length > 0 ? (
            <section className="panel rounded-sm">
              <header className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
                <h2 className="font-display text-[16px] tracking-[0.04em]">
                  TOP PRODUCTOS EN VENTAS BAJO COSTO
                </h2>
              </header>
              <div className="divide-y divide-steel-800/40">
                {topProducts.map((p, idx) => (
                  <div key={p.product_id} className="flex items-center gap-4 px-5 py-3">
                    <span className="w-5 shrink-0 font-mono text-[11px] font-bold tabular-nums text-muted-foreground/40">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-[13px] text-foreground">{p.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground/60">{p.sku}</div>
                    </div>
                    <span className="shrink-0 rounded-sm border border-signal-600/40 bg-signal-700/10 px-2 py-0.5 font-mono text-[11px] font-bold text-signal-400">
                      {p.sale_count} venta{p.sale_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* ── Main audit table ─────────────────────────────────────────── */}
          <section className="panel rounded-sm">
            <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
              <h2 className="font-display text-[16px] tracking-[0.04em]">VENTAS BAJO COSTO</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
                {count} override{count !== 1 ? "s" : ""}
              </span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="border-b border-steel-800 bg-steel-950/40">
                  <tr>
                    <Th>Fecha</Th>
                    <Th>Cliente</Th>
                    <Th>Tipo</Th>
                    <Th className="text-right">Total c/IVA</Th>
                    <Th className="text-right">Pérdida est.</Th>
                    <Th>Estado</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-steel-800/50 transition-colors hover:bg-steel-900/40"
                    >
                      <Td className="whitespace-nowrap">
                        <div className="font-mono text-[11.5px] tabular-nums text-foreground">
                          {dateFmt.format(new Date(r.display_date + "T00:00:00"))}
                        </div>
                        <div className="font-mono text-[9px] text-muted-foreground/40">
                          #{r.id.slice(0, 8).toUpperCase()}
                        </div>
                      </Td>
                      <Td>
                        <div className="font-semibold text-[13px] text-foreground">{r.customer_name}</div>
                        {r.customer_ruc ? (
                          <div className="font-mono text-[10px] text-muted-foreground/60">{r.customer_ruc}</div>
                        ) : null}
                      </Td>
                      <Td>
                        <span className="rounded-sm border border-steel-600 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground/70">
                          {docLabel(r.document_kind)}
                        </span>
                      </Td>
                      <Td className="text-right font-mono text-[13px] tabular-nums text-foreground">
                        {moneyFmt.format(r.total)}
                      </Td>
                      <Td className="text-right">
                        {r.loss_estimated > 0 ? (
                          <span className="font-mono text-[13px] font-bold tabular-nums text-red-400">
                            −{moneyFmt.format(r.loss_estimated)}
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] text-muted-foreground/40">
                            {r.is_legacy ? "N/D (legado)" : "—"}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase text-signal-400">
                            Bajo costo
                          </span>
                          {r.is_legacy ? (
                            <span className="font-mono text-[8px] text-muted-foreground/40">
                              (legado)
                            </span>
                          ) : null}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-steel-700 bg-steel-950/60">
                    <td colSpan={3} className="px-5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                      Total período
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-[13px] font-bold tabular-nums text-foreground">
                      {moneyFmt.format(totalSaleValue)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-[14px] font-bold tabular-nums text-red-400">
                      {totalLoss > 0 ? `−${moneyFmt.format(totalLoss)}` : "—"}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Legacy note */}
            {rows.some((r) => r.is_legacy) ? (
              <div className="border-t border-steel-800 px-5 py-2.5">
                <p className="font-mono text-[10px] text-muted-foreground/40">
                  (legado) = registros anteriores a la migración v18. El monto de pérdida no está disponible para esos registros.
                </p>
              </div>
            ) : null}
          </section>

          {/* ── Preparado para fase 2 ─────────────────────────────────────── */}
          <div className="panel rounded-sm border-l-2 border-steel-700/50 px-5 py-3.5">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/50">
              Fase 2 pendiente
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/40">
              Manager override con PIN · Motivo obligatorio · override_by user · Política por rol (advertencia / bloqueo / gerente)
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, danger,
}: {
  label:   string;
  value:   string;
  sub?:    string;
  danger?: boolean;
}) {
  return (
    <div className={["panel rounded-sm px-4 py-3.5", danger ? "border-red-500/30" : ""].join(" ")}>
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">{label}</div>
      <div className={[
        "mt-1 font-mono text-[19px] font-bold tabular-nums sm:text-[21px]",
        danger ? "text-red-400" : "text-foreground",
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
