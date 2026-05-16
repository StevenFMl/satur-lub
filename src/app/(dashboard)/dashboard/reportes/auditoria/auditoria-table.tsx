"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { todayEC } from "@/lib/date-ec";

// ── Types ──────────────────────────────────────────────────────────────────

export type AuditRow = {
  id:                       string;
  return_type:              "full" | "partial" | "exchange";
  reason:                   string;
  processed_at:             string;
  refund_amount:            number;
  refund_method:            string | null;
  exchange_credit_applied:   number;
  exchange_credit_refunded:  number;
  exchange_sale_id:         string | null;
  original_sale_id:         string;
  // Original sale fields
  sale_date:    string | null;
  sale_total:   number;
  customer_name: string;
  // Exchange sale fields (null when no exchange)
  exchange_date:  string | null;
  exchange_total: number | null;
  // Aggregate from items
  items_count:  number;
  items_refund: number;
};

type FilterType = "all" | "full" | "partial" | "exchange" | "refunded" | "no_refund";

// ── Formatters ─────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const REFUND_LABELS: Record<string, string> = {
  cash:     "Efectivo",
  transfer: "Transferencia",
  store_credit: "Nota",
};

const TYPE_LABELS: Record<string, string> = {
  full:     "Total",
  partial:  "Parcial",
  exchange: "Cambio",
};

function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit", month: "2-digit", year: "2-digit",
  });
}

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export function AuditoriaTable({
  from,
  to,
  rows,
}: {
  from: string;
  to:   string;
  rows: AuditRow[];
}) {
  const router = useRouter();
  const today  = React.useMemo(() => todayEC(), []);

  const [fromInput,   setFromInput]   = React.useState(from);
  const [toInput,     setToInput]     = React.useState(() => to > today ? today : to);
  const [typeFilter,  setTypeFilter]  = React.useState<FilterType>("all");
  const [search,      setSearch]      = React.useState("");
  const [expandedId,  setExpandedId]  = React.useState<string | null>(null);

  const applyFilter = () => {
    if (!fromInput || !toInput) return;
    const params = new URLSearchParams({ from: fromInput, to: toInput });
    router.push(`/dashboard/reportes/auditoria?${params}`);
  };

  // ── Client-side filtering ──────────────────────────────────
  const filtered = React.useMemo(() => {
    let r = rows;

    if (typeFilter === "full")     r = r.filter(x => x.return_type === "full");
    if (typeFilter === "partial")  r = r.filter(x => x.return_type === "partial");
    if (typeFilter === "exchange") r = r.filter(x => x.return_type === "exchange");
    if (typeFilter === "refunded") r = r.filter(x => x.refund_amount > 0.01 && x.refund_method != null);
    if (typeFilter === "no_refund")r = r.filter(x => !x.refund_method || x.refund_amount < 0.01);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(x =>
        x.customer_name.toLowerCase().includes(q) ||
        x.original_sale_id.toLowerCase().includes(q) ||
        x.id.toLowerCase().includes(q) ||
        (x.exchange_sale_id?.toLowerCase().includes(q) ?? false)
      );
    }

    return r;
  }, [rows, typeFilter, search]);

  // ── KPIs ────────────────────────────────────────────────────
  const kpi = React.useMemo(() => {
    const totalDevol  = rows.length;
    const totalExch   = rows.filter(r => r.return_type === "exchange").length;
    const totalRefund = rows.reduce((s, r) => s + r.refund_amount, 0);
    const totalCedido = rows.reduce((s, r) => {
      const c = r.refund_amount - r.exchange_credit_applied - r.exchange_credit_refunded;
      return s + (c > 0.005 ? c : 0);
    }, 0);
    return { totalDevol, totalExch, totalRefund, totalCedido };
  }, [rows]);

  const TYPE_FILTERS: { key: FilterType; label: string }[] = [
    { key: "all",       label: "Todas" },
    { key: "full",      label: "Totales" },
    { key: "partial",   label: "Parciales" },
    { key: "exchange",  label: "Cambios" },
    { key: "refunded",  label: "Con reembolso" },
    { key: "no_refund", label: "Sin reembolso" },
  ];

  return (
    <div className="space-y-5">

      {/* ── KPI cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Devoluciones" value={kpi.totalDevol} />
        <KpiCard label="Cambios"      value={kpi.totalExch} />
        <KpiCard label="Total reembolsado" value={moneyFmt.format(kpi.totalRefund)} money />
        <KpiCard label="Crédito cedido"    value={moneyFmt.format(kpi.totalCedido)} money warn={kpi.totalCedido > 0} />
      </div>

      {/* ── Filters ───────────────────────────────────────── */}
      <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-3 space-y-3">
        {/* Date range */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
              Desde
            </label>
            <Input
              type="date" value={fromInput} max={toInput || today} mono className="h-9 w-36"
              onChange={(e) => setFromInput(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
              Hasta
            </label>
            <Input
              type="date" value={toInput} min={fromInput} max={today} mono className="h-9 w-36"
              onChange={(e) => setToInput(e.target.value)}
            />
          </div>
          <Button size="md" onClick={applyFilter} className="h-9">Aplicar</Button>
          <div className="flex-1 min-w-[160px]">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente, venta, devolución..."
              className="h-9"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Type filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTypeFilter(key)}
              className={[
                "rounded-sm border px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] transition-colors",
                typeFilter === key
                  ? "border-safety-500/60 bg-safety-500/10 text-safety-500"
                  : "border-steel-700 text-muted-foreground/60 hover:border-steel-600 hover:text-muted-foreground",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="rounded-sm border border-steel-700 py-16 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/50">
            Sin registros en este período
          </p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-sm border border-steel-700">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead className="border-b border-steel-700 bg-steel-900/70">
                <tr>
                  {["Fecha proceso", "Tipo", "Cliente", "Venta orig.", "Reembolso", "Crédito usado", "Venta cambio", ""].map(h => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isExpanded = expandedId === r.id;
                  const cedido = Math.max(0, Number(
                    (r.refund_amount - r.exchange_credit_applied - r.exchange_credit_refunded).toFixed(2)
                  ));
                  return (
                    <React.Fragment key={r.id}>
                      <tr
                        className={[
                          "cursor-pointer border-b border-steel-800/50 transition-colors hover:bg-steel-800/20",
                          isExpanded ? "bg-steel-800/30" : "",
                          r.return_type === "exchange" ? "border-l-2 border-l-safety-500/30" : "",
                        ].join(" ")}
                        onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      >
                        <Td>
                          <div className="font-mono text-[10.5px] tabular-nums text-foreground">
                            {fmtDatetime(r.processed_at)}
                          </div>
                          <div className="font-mono text-[9px] text-muted-foreground/50 mt-0.5">
                            #{r.id.slice(0, 8).toUpperCase()}
                          </div>
                        </Td>

                        <Td>
                          <span className={[
                            "rounded-sm border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.08em]",
                            r.return_type === "exchange"
                              ? "border-sky-600/40 bg-sky-700/10 text-sky-400"
                              : r.return_type === "full"
                                ? "border-signal-600/40 bg-signal-700/10 text-signal-400"
                                : "border-steel-600/50 text-muted-foreground/70",
                          ].join(" ")}>
                            {TYPE_LABELS[r.return_type] ?? r.return_type}
                          </span>
                        </Td>

                        <Td>
                          <div className="truncate max-w-[140px] text-[12px] font-semibold text-foreground">
                            {r.customer_name}
                          </div>
                          {r.sale_date && (
                            <div className="font-mono text-[9.5px] text-muted-foreground/50">
                              venta {fmtDateShort(r.sale_date)}
                            </div>
                          )}
                        </Td>

                        <Td>
                          <div className="font-mono text-[11px] tabular-nums text-foreground">
                            {moneyFmt.format(r.sale_total)}
                          </div>
                          <Link
                            href={`/dashboard/pos/ventas/${r.original_sale_id}`}
                            onClick={e => e.stopPropagation()}
                            className="font-mono text-[8.5px] text-safety-500/60 hover:text-safety-500 transition-colors"
                          >
                            #{r.original_sale_id.slice(0, 6).toUpperCase()} →
                          </Link>
                        </Td>

                        <Td>
                          <div className="font-mono text-[11.5px] font-semibold tabular-nums text-safety-400">
                            {moneyFmt.format(r.refund_amount)}
                          </div>
                          {r.refund_method && (
                            <div className="font-mono text-[9px] text-muted-foreground/50">
                              {REFUND_LABELS[r.refund_method] ?? r.refund_method}
                            </div>
                          )}
                        </Td>

                        <Td>
                          {r.return_type === "exchange" ? (
                            <div className="space-y-0.5">
                              {r.exchange_credit_applied > 0 && (
                                <div className="font-mono text-[10.5px] font-bold tabular-nums text-safety-500">
                                  {moneyFmt.format(r.exchange_credit_applied)}
                                </div>
                              )}
                              {r.exchange_credit_refunded > 0 && (
                                <div className="font-mono text-[9.5px] tabular-nums text-muted-foreground/60">
                                  +{moneyFmt.format(r.exchange_credit_refunded)} reimb.
                                </div>
                              )}
                              {cedido > 0.005 && (
                                <div className="font-mono text-[9px] tabular-nums text-amber-400/70">
                                  {moneyFmt.format(cedido)} cedido
                                </div>
                              )}
                              {!r.exchange_sale_id && r.exchange_credit_applied === 0 && (
                                <span className="font-mono text-[9px] text-amber-400/60">
                                  pendiente
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="font-mono text-[10px] text-muted-foreground/30">—</span>
                          )}
                        </Td>

                        <Td>
                          {r.exchange_sale_id ? (
                            <div>
                              <div className="font-mono text-[11px] tabular-nums text-foreground">
                                {r.exchange_total != null ? moneyFmt.format(r.exchange_total) : "—"}
                              </div>
                              <Link
                                href={`/dashboard/pos/ventas/${r.exchange_sale_id}`}
                                onClick={e => e.stopPropagation()}
                                className="font-mono text-[8.5px] text-sky-400/60 hover:text-sky-400 transition-colors"
                              >
                                #{r.exchange_sale_id.slice(0, 6).toUpperCase()} →
                              </Link>
                            </div>
                          ) : r.return_type === "exchange" ? (
                            <span className="font-mono text-[9px] text-amber-400/60">
                              Pendiente
                            </span>
                          ) : (
                            <span className="font-mono text-[10px] text-muted-foreground/30">—</span>
                          )}
                        </Td>

                        <Td>
                          <ChevronIcon className={[
                            "h-3.5 w-3.5 text-muted-foreground/40 transition-transform",
                            isExpanded ? "rotate-180" : "",
                          ].join(" ")} />
                        </Td>
                      </tr>

                      {/* ── Expanded detail ─────────────────── */}
                      {isExpanded && (
                        <tr className="border-b border-steel-800/50 bg-steel-950/60">
                          <td colSpan={8} className="px-5 py-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

                              {/* Left: cycle chain */}
                              <div className="space-y-2">
                                <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
                                  Ciclo venta · devolución · cambio
                                </p>
                                <CycleChain row={r} cedido={cedido} />
                              </div>

                              {/* Right: motivo + items */}
                              <div className="space-y-2">
                                <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50">
                                  Detalle
                                </p>
                                <p className="text-[12px] text-foreground/80">{r.reason}</p>
                                <div className="flex gap-3 font-mono text-[10px] text-muted-foreground/60">
                                  <span>{r.items_count} ítem{r.items_count !== 1 ? "s" : ""}</span>
                                  <span>Subtotal devolución: {moneyFmt.format(r.items_refund)}</span>
                                </div>
                                <div className="flex gap-2">
                                  <Link
                                    href={`/dashboard/pos/ventas/${r.original_sale_id}`}
                                    className="rounded-sm border border-steel-600/50 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/60 transition-colors hover:border-safety-500/40 hover:text-safety-500"
                                  >
                                    Ver venta original
                                  </Link>
                                  {r.exchange_sale_id && (
                                    <Link
                                      href={`/dashboard/pos/ventas/${r.exchange_sale_id}`}
                                      className="rounded-sm border border-sky-600/40 bg-sky-700/10 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-sky-400 transition-colors hover:bg-sky-700/20"
                                    >
                                      Ver venta de cambio
                                    </Link>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-steel-700 bg-steel-900/60 px-5 py-2">
            <p className="font-mono text-[9.5px] text-muted-foreground/50">
              {filtered.length} registro{filtered.length !== 1 ? "s" : ""}
              {filtered.length !== rows.length ? ` de ${rows.length}` : ""} · período de devolución
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

// ── CycleChain ─────────────────────────────────────────────────────────────
// Visualizes the sale → return → exchange chain in a compact table.

function CycleChain({ row, cedido }: { row: AuditRow; cedido: number }) {
  const moneyFmt2 = new Intl.NumberFormat("es-EC", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  });

  return (
    <div className="space-y-1.5">
      {/* Original sale */}
      <div className="flex items-center justify-between rounded-sm border border-steel-700/60 px-3 py-2">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground/50">Venta original</p>
          <p className="font-mono text-[11px] tabular-nums font-semibold text-foreground">
            {moneyFmt2.format(row.sale_total)}
          </p>
        </div>
        <Link href={`/dashboard/pos/ventas/${row.original_sale_id}`}
          className="font-mono text-[8.5px] text-safety-500/60 hover:text-safety-500">
          #{row.original_sale_id.slice(0, 6).toUpperCase()} →
        </Link>
      </div>

      {/* Arrow down */}
      <div className="flex justify-center">
        <svg className="h-3 w-3 text-muted-foreground/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </div>

      {/* Devolución */}
      <div className="flex items-center justify-between rounded-sm border border-signal-700/40 bg-signal-900/10 px-3 py-2">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-signal-400/60">Devolución</p>
          <p className="font-mono text-[11px] tabular-nums font-semibold text-safety-400">
            −{moneyFmt2.format(row.refund_amount)}
          </p>
        </div>
        <p className="font-mono text-[8.5px] text-muted-foreground/40">
          #{row.id.slice(0, 6).toUpperCase()}
        </p>
      </div>

      {/* Exchange chain (only for exchange type) */}
      {row.return_type === "exchange" && (
        <>
          <div className="flex justify-center">
            <svg className="h-3 w-3 text-safety-500/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </div>

          {/* Credit breakdown */}
          <div className="rounded-sm border border-safety-500/20 bg-safety-500/5 px-3 py-2 space-y-1">
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-safety-500/60">Crédito por cambio</p>
            {row.exchange_credit_applied > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[9.5px] text-muted-foreground/60">Aplicado a nueva venta</span>
                <span className="font-mono text-[10.5px] font-bold tabular-nums text-safety-400">
                  {moneyFmt2.format(row.exchange_credit_applied)}
                </span>
              </div>
            )}
            {row.exchange_credit_refunded > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[9.5px] text-muted-foreground/60">Reembolsado en caja</span>
                <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  {moneyFmt2.format(row.exchange_credit_refunded)}
                </span>
              </div>
            )}
            {cedido > 0.005 && (
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[9.5px] text-amber-400/70">Crédito cedido (sin reembolso)</span>
                <span className="font-mono text-[10.5px] tabular-nums text-amber-400/70">
                  {moneyFmt2.format(cedido)}
                </span>
              </div>
            )}
          </div>

          {/* Exchange sale */}
          {row.exchange_sale_id ? (
            <>
              <div className="flex justify-center">
                <svg className="h-3 w-3 text-sky-500/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12l7 7 7-7" />
                </svg>
              </div>
              <div className="flex items-center justify-between rounded-sm border border-sky-700/40 bg-sky-900/10 px-3 py-2">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-sky-400/60">Nueva venta (cambio)</p>
                  <p className="font-mono text-[11px] tabular-nums font-semibold text-foreground">
                    {row.exchange_total != null ? moneyFmt2.format(row.exchange_total) : "—"}
                  </p>
                  {row.exchange_date && (
                    <p className="font-mono text-[9px] text-muted-foreground/40">
                      {new Date(row.exchange_date + "T12:00:00Z").toLocaleDateString("es-EC", {
                        timeZone: "America/Guayaquil",
                        day: "2-digit", month: "2-digit",
                      })}
                    </p>
                  )}
                </div>
                <Link href={`/dashboard/pos/ventas/${row.exchange_sale_id}`}
                  className="font-mono text-[8.5px] text-sky-400/60 hover:text-sky-400">
                  #{row.exchange_sale_id.slice(0, 6).toUpperCase()} →
                </Link>
              </div>
            </>
          ) : (
            <div className="rounded-sm border border-amber-600/20 bg-amber-900/10 px-3 py-2">
              <p className="font-mono text-[9.5px] text-amber-400/60">
                Nueva venta pendiente de registro
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function KpiCard({
  label, value, money, warn,
}: {
  label:  string;
  value:  string | number;
  money?: boolean;
  warn?:  boolean;
}) {
  return (
    <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-3 py-2.5 space-y-0.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60">{label}</p>
      <p className={[
        "tabular-nums leading-none",
        money
          ? warn
            ? "font-display text-[20px] text-amber-400"
            : "font-display text-[20px] text-foreground"
          : "font-display text-[22px] text-safety-500",
      ].join(" ")}>
        {value}
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3 py-2.5 align-top">
      {children}
    </td>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
