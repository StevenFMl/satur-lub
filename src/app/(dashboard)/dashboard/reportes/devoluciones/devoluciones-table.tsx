"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { todayEC } from "@/lib/date-ec";

// ── Types ──────────────────────────────────────────────────────────────────

export type DevolucionItem = {
  sale_item_id:      string;
  quantity_returned: number;
  base_qty:          number;
  line_refund:       number;
  restock:           boolean;
  item_name:         string;
};

export type DevolucionRow = {
  id:                      string;
  return_type:             "full" | "partial" | "exchange";
  reason:                  string;
  notes:                   string | null;
  refund_amount:           number;
  refund_method:           string | null;
  refund_reference:        string | null;
  processed_at:            string;
  original_sale_id:        string;
  exchange_sale_id:        string | null;
  exchange_credit_applied:  number;
  exchange_credit_refunded: number;
  sale_date:        string | null;
  document_kind:    string;
  customer_name:    string;
  items:            DevolucionItem[];
};

// ── Formatters ─────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const numFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0, maximumFractionDigits: 4,
});

const REFUND_METHOD_LABELS: Record<string, string> = {
  cash:         "Efectivo",
  transfer:     "Transferencia",
  store_credit: "Nota a favor",
};

const RETURN_TYPE_LABELS: Record<string, string> = {
  full:     "Total",
  partial:  "Parcial",
  exchange: "Cambio",
};

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    timeZone:  "America/Guayaquil",
    day:    "2-digit", month: "2-digit",
    hour:   "2-digit", minute: "2-digit",
    hour12: false,
  });
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit", month: "short", year: "numeric",
  });
}

function downloadCsv(filename: string, headers: string[], rows: string[][]): void {
  const esc  = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const body = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────────────────────────

export function DevolucionesTable({
  from, to, rows,
}: {
  from: string;
  to:   string;
  rows: DevolucionRow[];
}) {
  const router                      = useRouter();
  const today                       = React.useMemo(() => todayEC(), []);
  const [fromInput, setFromInput]   = React.useState(from);
  const [toInput,   setToInput]     = React.useState(() => to > today ? today : to);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const applyFilter = () => {
    if (!fromInput || !toInput) return;
    const clampedTo = toInput > today ? today : toInput;
    router.push(
      `/dashboard/reportes/devoluciones?from=${fromInput}&to=${clampedTo}`,
      { scroll: false }
    );
  };

  // ── KPIs ────────────────────────────────────────────────────────
  const totalDevuelto  = rows.reduce((s, r) => s + r.refund_amount, 0);
  const countTotal     = rows.length;
  const enEfectivo     = rows.filter((r) => r.refund_method === "cash").reduce((s, r) => s + r.refund_amount, 0);
  const countEfectivo  = rows.filter((r) => r.refund_method === "cash").length;
  const countParciales = rows.filter((r) => r.return_type === "partial").length;

  // ── CSV ─────────────────────────────────────────────────────────
  const exportCsv = () => {
    // Use ISO datetime (YYYY-MM-DD HH:mm) so Excel parses dates correctly.
    // Locale-formatted datetime contains a comma which, even when quoted, is
    // less reliable across Excel versions.
    const isoDatetime = (iso: string) => {
      const d = new Date(iso);
      const parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "America/Guayaquil",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(d);
      const m: Record<string, string> = {};
      for (const { type, value } of parts) m[type] = value;
      return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}`;
    };

    downloadCsv(
      `devoluciones_${from}_${to}.csv`,
      ["Fecha_Proceso", "ID_Devolucion", "ID_Venta_Original", "Cliente", "Tipo",
       "Metodo_Reembolso", "Monto_USD", "Motivo"],
      rows.map((r) => [
        isoDatetime(r.processed_at),
        r.id.slice(0, 8).toUpperCase(),
        r.original_sale_id.slice(0, 8).toUpperCase(),
        r.customer_name,
        RETURN_TYPE_LABELS[r.return_type] ?? r.return_type,
        r.refund_method ? (REFUND_METHOD_LABELS[r.refund_method] ?? r.refund_method) : "Sin reembolso",
        r.refund_amount.toFixed(2),
        r.reason,
      ])
    );
  };

  return (
    <div className="space-y-6">

      {/* ── Filters ───────────────────────────────────────────────── */}
      <div className="panel rounded-sm">
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="space-y-1">
            <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
              Desde
            </label>
            <Input
              type="date" value={fromInput} max={today}
              onChange={(e) => setFromInput(e.target.value)}
              mono className="h-9 w-full sm:w-40"
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">
              Hasta
            </label>
            <Input
              type="date" value={toInput} max={today}
              onChange={(e) => setToInput(e.target.value > today ? today : e.target.value)}
              mono className="h-9 w-full sm:w-40"
            />
          </div>
          <Button type="button" size="md" onClick={applyFilter}>Aplicar</Button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-800 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
        <div className="border-t border-steel-800/60 px-5 py-2">
          <p className="font-mono text-[10px] text-muted-foreground/50">
            {from} → {to} · Ordenado por fecha de procesamiento
          </p>
        </div>
      </div>

      {/* ── KPIs ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total devuelto"    value={moneyFmt.format(totalDevuelto)} />
        <KpiCard label="N° devoluciones"   value={String(countTotal)} />
        <KpiCard
          label="En efectivo"
          value={moneyFmt.format(enEfectivo)}
          sub={`${countEfectivo} doc.`}
          warn={enEfectivo > 0}
        />
        <KpiCard label="Parciales" value={String(countParciales)} sub="devolución parcial" />
      </div>

      {/* ── Table ─────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <div className="panel rounded-sm px-6 py-12 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            Sin devoluciones en el período seleccionado.
          </p>
        </div>
      ) : (
        <section className="panel rounded-sm">
          <header className="top-highlight flex items-center justify-between border-b-2 border-steel-700 bg-steel-900/70 px-5 py-3.5">
            <h2 className="font-display text-[16px] tracking-[0.04em]">HISTORIAL</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">
              {rows.length} devolución{rows.length !== 1 ? "es" : ""}
            </span>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="border-b border-steel-800 bg-steel-950/40">
                <tr>
                  <Th>Fecha</Th>
                  <Th>Venta / Cliente</Th>
                  <Th>Tipo</Th>
                  <Th>Motivo</Th>
                  <Th>Reembolso</Th>
                  <Th className="text-right">Monto</Th>
                  <Th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isExpanded = expandedId === r.id;
                  return (
                    <React.Fragment key={r.id}>
                      <tr
                        className={[
                          "border-b border-steel-800/50 transition-colors",
                          isExpanded ? "bg-steel-900/40" : "hover:bg-steel-900/30 cursor-pointer",
                        ].join(" ")}
                        onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      >
                        <Td className="whitespace-nowrap">
                          <span className="font-mono text-[11px] tabular-nums text-foreground">
                            {fmtDatetime(r.processed_at)}
                          </span>
                        </Td>

                        <Td>
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/dashboard/pos/ventas/${r.original_sale_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-safety-400/70 hover:text-safety-400 hover:underline"
                            >
                              #{r.original_sale_id.slice(0, 8).toUpperCase()}
                            </Link>
                            <span className="font-mono text-[9px] text-muted-foreground/40">
                              {r.sale_date ? fmtDate(r.sale_date) : ""}
                            </span>
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-foreground/80">
                            {r.customer_name}
                          </div>
                        </Td>

                        <Td>
                          <span className={[
                            "rounded-sm border px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em]",
                            r.return_type === "full"
                              ? "border-signal-600/40 bg-signal-700/10 text-signal-400"
                              : r.return_type === "exchange"
                                ? "border-sky-600/40 bg-sky-700/10 text-sky-400"
                                : "border-steel-600/50 text-muted-foreground/70",
                          ].join(" ")}>
                            {RETURN_TYPE_LABELS[r.return_type] ?? r.return_type}
                          </span>
                        </Td>

                        <Td>
                          <p className="max-w-[200px] truncate text-[11.5px] text-foreground/80"
                            title={r.reason}>
                            {r.reason}
                          </p>
                        </Td>

                        <Td>
                          {r.refund_method ? (
                            <span className={[
                              "font-mono text-[10.5px]",
                              r.refund_method === "cash"
                                ? "text-amber-400/80"
                                : "text-muted-foreground/60",
                            ].join(" ")}>
                              {REFUND_METHOD_LABELS[r.refund_method] ?? r.refund_method}
                            </span>
                          ) : (
                            <span className="font-mono text-[10px] text-muted-foreground/30">—</span>
                          )}
                        </Td>

                        <Td className="text-right">
                          <span className="font-mono text-[13.5px] font-bold tabular-nums text-foreground">
                            {moneyFmt.format(r.refund_amount)}
                          </span>
                        </Td>

                        <Td>
                          <ChevronIcon
                            className={[
                              "h-3.5 w-3.5 text-muted-foreground/40 transition-transform",
                              isExpanded ? "rotate-180" : "",
                            ].join(" ")}
                          />
                        </Td>
                      </tr>

                      {/* ── Expanded items ─────────────────────────── */}
                      {isExpanded && r.items.length > 0 ? (
                        <tr className="border-b border-steel-800/50 bg-steel-950/50">
                          <td colSpan={7} className="px-5 py-3">
                            <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/50">
                              Líneas devueltas
                            </p>
                            <div className="overflow-hidden rounded-sm border border-steel-700/50">
                              <table className="w-full text-left">
                                <thead className="border-b border-steel-700/50 bg-steel-900/60">
                                  <tr>
                                    <th className="px-3 py-1.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
                                      Producto
                                    </th>
                                    <th className="px-3 py-1.5 text-right font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
                                      Cant.
                                    </th>
                                    <th className="px-3 py-1.5 text-right font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
                                      Base
                                    </th>
                                    <th className="px-3 py-1.5 text-right font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
                                      Reembolso línea
                                    </th>
                                    <th className="px-3 py-1.5 text-center font-mono text-[8.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
                                      Stock
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.items.map((item) => (
                                    <tr
                                      key={item.sale_item_id}
                                      className="border-b border-steel-800/30 last:border-0"
                                    >
                                      <td className="px-3 py-2 text-[12px] font-semibold text-foreground/85">
                                        {item.item_name}
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono text-[11.5px] tabular-nums text-muted-foreground">
                                        {numFmt.format(item.quantity_returned)}
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono text-[11px] tabular-nums text-muted-foreground/60">
                                        {item.base_qty !== 1 ? numFmt.format(item.base_qty) : "—"}
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono text-[12px] font-semibold tabular-nums text-safety-400">
                                        {moneyFmt.format(item.line_refund)}
                                      </td>
                                      <td className="px-3 py-2 text-center">
                                        {item.restock ? (
                                          <span className="rounded-sm border border-signal-600/30 bg-signal-700/10 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase text-signal-400/70">
                                            Reingresó
                                          </span>
                                        ) : (
                                          <span className="rounded-sm border border-red-500/30 bg-red-500/5 px-1.5 py-0.5 font-mono text-[8px] uppercase text-red-400/70">
                                            No reingresa
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {r.notes ? (
                              <p className="mt-2 font-mono text-[10px] text-muted-foreground/50">
                                Nota: {r.notes}
                              </p>
                            ) : null}

                            {/* Exchange credit audit — only for exchange type */}
                            {r.return_type === "exchange" && (() => {
                              const cedido = Math.max(0, Number(
                                (r.refund_amount - r.exchange_credit_applied - r.exchange_credit_refunded)
                                  .toFixed(2)
                              ));
                              return (
                                <div className="mt-3 rounded-sm border border-safety-500/20 bg-safety-500/5 px-3 py-2.5 space-y-2">
                                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-safety-500/70">
                                    Crédito del cambio
                                  </p>

                                  {/* Four-column credit breakdown */}
                                  <div className="grid grid-cols-4 gap-2">
                                    <CreditAuditCell
                                      label="Crédito original"
                                      value={moneyFmt.format(r.refund_amount)}
                                    />
                                    <CreditAuditCell
                                      label="Aplicado a cambio"
                                      value={r.exchange_credit_applied > 0
                                        ? moneyFmt.format(r.exchange_credit_applied)
                                        : "—"}
                                      accent={r.exchange_credit_applied > 0}
                                    />
                                    <CreditAuditCell
                                      label="Reembolsado en caja"
                                      value={r.exchange_credit_refunded > 0
                                        ? moneyFmt.format(r.exchange_credit_refunded)
                                        : "—"}
                                    />
                                    <CreditAuditCell
                                      label="Crédito cedido"
                                      value={cedido > 0.005 ? moneyFmt.format(cedido) : "—"}
                                      dim={cedido <= 0.005}
                                    />
                                  </div>

                                  {/* Invariant check: sum must equal refund_amount */}
                                  {cedido <= 0.005 && r.exchange_sale_id &&
                                    r.exchange_credit_applied + r.exchange_credit_refunded > 0 && (
                                    <p className="font-mono text-[9px] text-signal-400/60">
                                      ✓ Crédito 100% consumido
                                    </p>
                                  )}

                                  {r.exchange_sale_id ? (
                                    <Link
                                      href={`/dashboard/pos/ventas/${r.exchange_sale_id}`}
                                      className="inline-flex items-center gap-1 font-mono text-[9.5px] text-safety-500/70 hover:text-safety-500 transition-colors"
                                    >
                                      Ver venta de reemplazo →
                                    </Link>
                                  ) : (
                                    <p className="font-mono text-[9.5px] text-amber-400/60">
                                      Cambio pendiente — venta de reemplazo no registrada aún
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function CreditAuditCell({
  label, value, accent, dim,
}: {
  label:   string;
  value:   string;
  accent?: boolean;
  dim?:    boolean;
}) {
  return (
    <div>
      <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground/50">
        {label}
      </p>
      <p className={[
        "font-mono text-[11px] tabular-nums",
        accent ? "font-bold text-safety-400"
        : dim   ? "text-muted-foreground/30"
        :         "text-muted-foreground/70",
      ].join(" ")}>
        {value}
      </p>
    </div>
  );
}

function KpiCard({
  label, value, sub, warn,
}: {
  label: string; value: string; sub?: string; warn?: boolean;
}) {
  return (
    <div className="panel rounded-sm px-4 py-3.5">
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </div>
      <div className={[
        "mt-1 font-mono text-[19px] font-bold tabular-nums sm:text-[21px]",
        warn ? "text-amber-400" : "text-foreground",
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

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={"px-5 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground " + (className ?? "")}>
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={"px-5 py-3.5 align-middle " + (className ?? "")}>{children}</td>;
}

// ── Icons ──────────────────────────────────────────────────────────────────

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
