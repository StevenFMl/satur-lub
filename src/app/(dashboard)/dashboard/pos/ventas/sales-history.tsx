"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import type { SaleListItem, DaySummary } from "./page";
import { useVoidDialog } from "./void-dialog";
import { todayEC } from "@/lib/date-ec";
import { InvoiceRowActions } from "@/components/invoice/invoice-row-actions";

// ── Constants ──────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const METHOD_LABELS: Record<string, string> = {
  cash:     "Efectivo",
  card:     "Tarjeta",
  transfer: "Transferencia",
};

type StatusFilter  = "all" | "confirmed" | "cancelled";
type PaymentFilter = "all" | "cash" | "card" | "transfer";

// ── Helpers ────────────────────────────────────────────────────────────────

function adjDate(d: string, delta: number): string {
  const dt = new Date(d + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-EC", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-EC", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ── Main component ─────────────────────────────────────────────────────────

export function SalesHistory({
  sales,
  summary,
  date,
  canVoidSale,
  canEmit,
}: {
  sales:       SaleListItem[];
  summary:     DaySummary;
  date:        string;
  canVoidSale: boolean;
  canEmit:     boolean;
}) {
  const router               = useRouter();
  const today                = todayEC();
  const yesterday            = adjDate(today, -1);
  const isToday              = date === today;

  const [search,  setSearch]  = React.useState("");
  const [status,  setStatus]  = React.useState<StatusFilter>("all");
  const [payment, setPayment] = React.useState<PaymentFilter>("all");
  const voidDialog            = useVoidDialog();

  const go = (d: string) => router.push(`/dashboard/pos/ventas?date=${d}`);

  // ── Filter ────────────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return sales.filter((s) => {
      if (status !== "all" && s.status !== status) return false;
      if (payment !== "all" && !s.payment_methods.includes(payment)) return false;
      if (q && !s.customer_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sales, status, payment, search]);

  return (
    <div className="space-y-5">
      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-[22px] tracking-[0.04em]">VENTAS DEL DÍA</h1>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {fmtDate(date)}{isToday ? " · Hoy" : ""}
          </p>
        </div>
        <div className="flex items-center gap-4 self-start">
          <Link
            href="/dashboard/pos/ventas/productos"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            Productos →
          </Link>
          <Link
            href="/dashboard/pos/ventas/documentos"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            Comprobantes →
          </Link>
          <Link
            href="/dashboard/pos"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            ← Terminal
          </Link>
        </div>
      </div>

      {/* ── Date navigation ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <DateChip label="Hoy"  active={isToday}          onClick={() => go(today)} />
        <DateChip label="Ayer" active={date === yesterday} onClick={() => go(yesterday)} />
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => go(adjDate(date, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-steel-700 text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => { if (e.target.value) go(e.target.value); }}
            className="rounded-sm border border-steel-700 bg-steel-900 px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => !isToday && go(adjDate(date, 1))}
            disabled={isToday}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-steel-700 text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Summary ───────────────────────────────────────────────── */}
      {summary.confirmedCount > 0 || summary.cancelledCount > 0 ? (
        <div className="space-y-2.5">
          {/* Primary stat */}
          <div className="panel rounded-sm border-2 border-safety-500/30 bg-safety-500/5 px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
                  Total vendido
                </p>
                <p className="mt-0.5 font-display text-[36px] leading-none tracking-[0.02em] text-safety-500">
                  {moneyFmt.format(summary.totalGross)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-display text-[30px] leading-none text-foreground">
                  {summary.confirmedCount}
                </p>
                <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/60">
                  {summary.confirmedCount === 1 ? "venta" : "ventas"}
                </p>
              </div>
            </div>
          </div>

          {/* Payment breakdown */}
          {summary.paymentBreakdown.length > 0 ? (
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(summary.paymentBreakdown.length, 3)}, 1fr)` }}>
              {summary.paymentBreakdown.map((p) => (
                <div
                  key={p.method}
                  className="panel rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-2.5"
                >
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">
                    {METHOD_LABELS[p.method] ?? p.method}
                  </p>
                  <p className="mt-0.5 font-display text-[20px] leading-none tabular-nums text-foreground">
                    {moneyFmt.format(p.amount)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {/* Secondary metrics */}
          {(summary.totalDiscount > 0 || summary.overrideCount > 0 || summary.cancelledCount > 0) ? (
            <div className="flex flex-wrap gap-2">
              {summary.totalDiscount > 0 ? (
                <MetaChip label="Descuentos" value={moneyFmt.format(summary.totalDiscount)} />
              ) : null}
              {summary.overrideCount > 0 ? (
                <MetaChip
                  label={`${summary.overrideCount} ajuste${summary.overrideCount > 1 ? "s" : ""} precio`}
                  value={summary.overrideSavings > 0 ? `−${moneyFmt.format(summary.overrideSavings)}` : ""}
                  accent
                />
              ) : null}
              {summary.cancelledCount > 0 ? (
                <MetaChip
                  label={`${summary.cancelledCount} anulada${summary.cancelledCount > 1 ? "s" : ""}`}
                  value={moneyFmt.format(summary.cancelledGross)}
                  danger
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="panel flex flex-col items-center gap-3 rounded-sm py-10 text-center">
          <ReceiptIcon className="h-9 w-9 text-muted-foreground/30" />
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Sin ventas este día
          </p>
          <Link
            href="/dashboard/pos"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-safety-500/70 transition-colors hover:text-safety-500"
          >
            Ir al POS →
          </Link>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────── */}
      {sales.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Status tabs */}
          <div className="flex gap-1">
            {(["all", "confirmed", "cancelled"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={[
                  "h-8 rounded-sm border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
                  status === s
                    ? "border-safety-500 bg-safety-500/10 text-safety-500"
                    : "border-steel-700 text-muted-foreground hover:border-steel-600 hover:text-foreground",
                ].join(" ")}
              >
                {s === "all" ? "Todas" : s === "confirmed" ? "Activas" : "Anuladas"}
              </button>
            ))}
          </div>

          {/* Payment filter */}
          <div className="flex gap-1">
            {(["all", "cash", "card", "transfer"] as PaymentFilter[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPayment(m)}
                className={[
                  "h-8 rounded-sm border px-2.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em] transition-colors",
                  payment === m
                    ? "border-safety-500/60 bg-safety-500/10 text-safety-500"
                    : "border-steel-700 text-muted-foreground hover:border-steel-600 hover:text-foreground",
                ].join(" ")}
              >
                {m === "all" ? "$ Todo" : m === "cash" ? "Efectivo" : m === "card" ? "Tarjeta" : "Trans."}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente..."
              className="h-8 pl-9 text-[12px]"
            />
          </div>
        </div>
      ) : null}

      {/* ── Sales list ───────────────────────────────────────────── */}
      {sales.length > 0 && filtered.length === 0 ? (
        <p className="py-6 text-center font-mono text-[11px] text-muted-foreground">Sin resultados</p>
      ) : null}

      {filtered.length > 0 ? (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-sm border border-steel-700 sm:block">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b-2 border-steel-700 bg-steel-900/70">
                  {["#", "Hora", "Cliente", "Total", "Método", "Estado", "Comprobante SRI", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-800/50">
                {filtered.map((sale) => {
                  const isCancelled = sale.status === "cancelled";
                  return (
                    <tr
                      key={sale.id}
                      className={isCancelled ? "opacity-50" : "hover:bg-steel-800/30"}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
                          {sale.id.slice(0, 8).toUpperCase()}
                        </span>
                        {sale.has_override ? (
                          <span className="ml-1 rounded-sm border border-signal-600/40 bg-signal-700/10 px-1 font-mono text-[8px] font-bold uppercase text-signal-400">
                            Aj
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {fmtTime(sale.created_at)}
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-3 font-medium text-foreground">
                        {sale.customer_name}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold tabular-nums">
                        {moneyFmt.format(sale.total)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {sale.payment_methods.map((m) => METHOD_LABELS[m] ?? m).join(", ")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={sale.status} />
                      </td>
                      <td className="px-4 py-3">
                        <InvoiceRowActions
                          saleId={sale.id}
                          invoice={{
                            invoiceId:     sale.invoice_id,
                            invoiceStatus: sale.invoice_status,
                            docNumber:     sale.invoice_doc_number,
                            env:           sale.invoice_env,
                          }}
                          canEmit={canEmit}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/dashboard/pos/ventas/${sale.id}`}
                            className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 transition-colors hover:text-foreground"
                          >
                            Detalle →
                          </Link>
                          {canVoidSale && !isCancelled ? (
                            <button
                              type="button"
                              onClick={() => voidDialog.open(sale.id)}
                              className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40 transition-colors hover:text-red-400"
                            >
                              Anular
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 sm:hidden">
            {filtered.map((sale) => {
              const isCancelled = sale.status === "cancelled";
              return (
                <div
                  key={sale.id}
                  className={[
                    "panel rounded-sm border p-4",
                    isCancelled ? "border-steel-800/50 opacity-50" : "border-steel-700",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
                          {sale.id.slice(0, 8).toUpperCase()}
                        </span>
                        {sale.has_override ? (
                          <span className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-1 font-mono text-[8px] font-bold uppercase text-signal-400">Aj</span>
                        ) : null}
                        <StatusBadge status={sale.status} />
                      </div>
                      <div className="mt-0.5 font-semibold text-foreground">{sale.customer_name}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                        {fmtTime(sale.created_at)} · {sale.payment_methods.map((m) => METHOD_LABELS[m] ?? m).join(", ")}
                      </div>
                      <div className="mt-1.5">
                        <InvoiceRowActions
                          saleId={sale.id}
                          invoice={{
                            invoiceId:     sale.invoice_id,
                            invoiceStatus: sale.invoice_status,
                            docNumber:     sale.invoice_doc_number,
                            env:           sale.invoice_env,
                          }}
                          canEmit={canEmit}
                        />
                      </div>
                    </div>
                    <div className="shrink-0">
                      <div className="font-display text-[22px] leading-none text-safety-500">
                        {moneyFmt.format(sale.total)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-4 border-t border-steel-800/50 pt-2.5">
                    <Link
                      href={`/dashboard/pos/ventas/${sale.id}`}
                      className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 transition-colors hover:text-foreground"
                    >
                      Ver detalle →
                    </Link>
                    {canVoidSale && !isCancelled ? (
                      <button
                        type="button"
                        onClick={() => voidDialog.open(sale.id)}
                        className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/40 transition-colors hover:text-red-400"
                      >
                        Anular
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="font-mono text-[11px] text-muted-foreground/50">
            {filtered.length} de {sales.length} venta{sales.length !== 1 ? "s" : ""}
          </p>
        </>
      ) : null}

      {voidDialog.handle}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return status === "confirmed" ? (
    <span className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-signal-400">
      Activa
    </span>
  ) : (
    <span className="rounded-sm border border-red-500/30 bg-red-500/5 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] text-red-400">
      Anulada
    </span>
  );
}

function MetaChip({
  label,
  value,
  accent,
  danger,
}: {
  label:   string;
  value:   string;
  accent?: boolean;
  danger?: boolean;
}) {
  const cls = danger
    ? "border-red-500/30 bg-red-500/5 text-red-400"
    : accent
      ? "border-signal-600/30 bg-signal-700/10 text-signal-400"
      : "border-steel-700 bg-steel-900/60 text-muted-foreground";
  return (
    <div className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 ${cls}`}>
      <span className="font-mono text-[10px] uppercase tracking-[0.1em]">{label}</span>
      {value ? (
        <span className="font-mono text-[10.5px] font-bold tabular-nums">{value}</span>
      ) : null}
    </div>
  );
}

function DateChip({
  label,
  active,
  onClick,
}: {
  label:   string;
  active:  boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-8 rounded-sm border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
        active
          ? "border-safety-500/50 bg-safety-500/10 text-safety-500"
          : "border-steel-700 text-muted-foreground hover:border-steel-600 hover:text-foreground",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ReceiptIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 2v20l3-2 2.5 2L12 20l2.5 2L17 20l3 2V2z" />
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
