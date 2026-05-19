"use client";

import * as React from "react";
import Link       from "next/link";
import { Input }  from "@/components/ui/input";
import type { InvoiceListItem } from "./page";

// ── Constants ──────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const STATUS_LABELS: Record<string, string> = {
  draft:      "Borrador",
  signed:     "Firmado",
  sent:       "Enviado",
  authorized: "Autorizado",
  rejected:   "Rechazado",
  cancelled:  "Anulado",
};

const STATUS_COLORS: Record<string, string> = {
  draft:      "border-steel-600/50 text-muted-foreground/60",
  signed:     "border-sky-600/40 bg-sky-700/10 text-sky-400",
  sent:       "border-safety-500/40 bg-safety-500/5 text-safety-400",
  authorized: "border-signal-600/40 bg-signal-700/10 text-signal-400",
  rejected:   "border-red-500/40 bg-red-500/5 text-red-400",
  cancelled:  "border-steel-700 text-muted-foreground/50",
};

type StatusFilter  = "all" | "draft" | "signed" | "sent" | "authorized" | "rejected" | "cancelled";
type EnvFilter     = "all" | "produccion" | "pruebas";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00Z").toLocaleDateString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit", month: "2-digit", year: "2-digit",
  });
}

function fmtDatetime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ── Main component ─────────────────────────────────────────────────────────

export function DocumentsTable({
  invoices,
  canEmit,
}: {
  invoices: InvoiceListItem[];
  canEmit:  boolean;
}) {
  const [search,  setSearch]  = React.useState("");
  const [status,  setStatus]  = React.useState<StatusFilter>("all");
  const [env,     setEnv]     = React.useState<EnvFilter>("all");

  // ── Filter ──────────────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (status !== "all" && inv.status !== status) return false;
      if (env    !== "all" && inv.sri_environment !== env) return false;
      if (q) {
        const haystack = [
          inv.doc_number,
          inv.access_key,
          inv.authorization_number,
          inv.customer_name,
          inv.customer_doc,
        ].join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, status, env, search]);

  // Counts for status filter chips
  const counts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const inv of invoices) c[inv.status] = (c[inv.status] ?? 0) + 1;
    return c;
  }, [invoices]);

  return (
    <div className="space-y-5">

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <span className="hud-readout">Documentos · Comprobantes SRI</span>
          <h1 className="font-display text-[28px] leading-none tracking-[0.04em] sm:text-[36px]">
            FACTURAS ELECTRÓNICAS
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground/60">
            {invoices.length} comprobante{invoices.length !== 1 ? "s" : ""} · últimos 500
          </p>
        </div>
        <Link
          href="/dashboard/pos/ventas"
          className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          ← Ventas
        </Link>
      </div>

      {/* ── KPI chips ─────────────────────────────────────────────── */}
      {invoices.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {(["authorized", "rejected", "sent", "draft"] as StatusFilter[])
            .filter((s) => (counts[s] ?? 0) > 0)
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(status === s ? "all" : s)}
                className={[
                  "rounded-sm border px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors",
                  STATUS_COLORS[s],
                  status === s ? "ring-1 ring-current/40" : "opacity-70 hover:opacity-100",
                ].join(" ")}
              >
                {STATUS_LABELS[s]} · {counts[s]}
              </button>
            ))}
        </div>
      ) : null}

      {/* ── Filters ───────────────────────────────────────────────── */}
      {invoices.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Status filter */}
          <div className="flex gap-1 flex-wrap">
            {(["all", "authorized", "rejected", "sent", "signed", "draft", "cancelled"] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={[
                  "h-7 rounded-sm border px-2 font-mono text-[9px] font-bold uppercase tracking-[0.08em] transition-colors",
                  status === s
                    ? "border-safety-500 bg-safety-500/10 text-safety-500"
                    : "border-steel-700 text-muted-foreground hover:border-steel-600 hover:text-foreground",
                ].join(" ")}
              >
                {s === "all" ? "Todos" : STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Env filter */}
          <div className="flex gap-1">
            {(["all", "produccion", "pruebas"] as EnvFilter[]).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEnv(e)}
                className={[
                  "h-7 rounded-sm border px-2 font-mono text-[9px] font-bold uppercase tracking-[0.08em] transition-colors",
                  env === e
                    ? "border-safety-500/60 bg-safety-500/10 text-safety-500"
                    : "border-steel-700 text-muted-foreground hover:border-steel-600 hover:text-foreground",
                ].join(" ")}
              >
                {e === "all" ? "Ambos env." : e === "produccion" ? "Producción" : "Pruebas"}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="N° doc, cliente, clave de acceso, autorización..."
              className="h-8 pl-9 text-[12px]"
            />
          </div>
        </div>
      ) : null}

      {/* ── Empty states ──────────────────────────────────────────── */}
      {invoices.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-sm border border-steel-700 py-12 text-center">
          <InvoiceIcon className="h-9 w-9 text-muted-foreground/30" />
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            No hay comprobantes electrónicos
          </p>
          {canEmit ? (
            <Link
              href="/dashboard/pos/ventas"
              className="font-mono text-[10px] uppercase tracking-[0.1em] text-safety-500/70 hover:text-safety-500"
            >
              Ir a ventas para emitir →
            </Link>
          ) : null}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center font-mono text-[11px] text-muted-foreground">
          Sin resultados para los filtros seleccionados
        </p>
      ) : null}

      {/* ── Desktop table ─────────────────────────────────────────── */}
      {filtered.length > 0 ? (
        <>
          <div className="hidden overflow-hidden rounded-sm border border-steel-700 sm:block">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b-2 border-steel-700 bg-steel-900/70">
                  {["N° comprobante", "Cliente", "Fecha", "Total", "Ambiente", "Estado", ""].map((h) => (
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
                {filtered.map((inv) => (
                  <tr
                    key={inv.id}
                    className={inv.status === "cancelled" ? "opacity-40" : "hover:bg-steel-800/30"}
                  >
                    <td className="px-4 py-3">
                      <p className="font-mono text-[11px] font-bold text-foreground">{inv.doc_number}</p>
                      {inv.authorization_number ? (
                        <p className="font-mono text-[9px] text-muted-foreground/50" title={`Auth: ${inv.authorization_number}`}>
                          Auth: {inv.authorization_number.slice(0, 16)}…
                        </p>
                      ) : null}
                      {inv.access_key ? (
                        <p className="font-mono text-[8.5px] text-muted-foreground/30" title={inv.access_key}>
                          {inv.access_key.slice(0, 18)}…
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-[160px] truncate px-4 py-3">
                      <p className="font-medium text-foreground truncate">{inv.customer_name}</p>
                      {inv.customer_doc ? (
                        <p className="font-mono text-[9px] text-muted-foreground/50">{inv.customer_doc}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-muted-foreground">
                      <p>{fmtDate(inv.sale_date)}</p>
                      <p className="text-[9.5px] text-muted-foreground/50">{fmtDatetime(inv.created_at)}</p>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold tabular-nums">
                      {inv.sale_total != null ? moneyFmt.format(inv.sale_total) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {inv.sri_environment === "pruebas" ? (
                        <span className="rounded-sm border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase text-amber-400">
                          Pruebas
                        </span>
                      ) : (
                        <span className="rounded-sm border border-emerald-600/30 bg-emerald-700/5 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase text-emerald-400">
                          Producción
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={[
                        "rounded-sm border px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em]",
                        STATUS_COLORS[inv.status] ?? STATUS_COLORS.draft,
                      ].join(" ")}>
                        {STATUS_LABELS[inv.status] ?? inv.status}
                      </span>
                      {inv.authorization_date ? (
                        <p className="mt-0.5 font-mono text-[8.5px] text-muted-foreground/50">
                          {fmtDatetime(inv.authorization_date)}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        {inv.sale_id ? (
                          <Link
                            href={`/dashboard/pos/ventas/${inv.sale_id}#invoice`}
                            className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 hover:text-foreground transition-colors"
                          >
                            Ver →
                          </Link>
                        ) : null}
                        <a
                          href={`/api/invoices/${inv.id}/xml`}
                          download
                          title="Descargar XML"
                          className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/50 hover:text-foreground transition-colors"
                        >
                          ↓ XML
                        </a>
                        {(inv.status === "authorized" || inv.status === "sent" || inv.status === "signed") && inv.sale_id ? (
                          <Link
                            href={`/print/pos/ventas/${inv.sale_id}?format=a4`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/50 hover:text-foreground transition-colors"
                          >
                            ↗ A4
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ─────────────────────────────────────── */}
          <div className="space-y-2 sm:hidden">
            {filtered.map((inv) => (
              <div
                key={inv.id}
                className={[
                  "rounded-sm border p-4 space-y-2",
                  inv.status === "cancelled" ? "border-steel-800/50 opacity-40" : "border-steel-700",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] font-bold text-foreground">{inv.doc_number}</p>
                    <p className="font-medium text-foreground truncate">{inv.customer_name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground/70">
                      {fmtDate(inv.sale_date)} · {inv.sale_total != null ? moneyFmt.format(inv.sale_total) : "—"}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className={[
                      "rounded-sm border px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em]",
                      STATUS_COLORS[inv.status] ?? STATUS_COLORS.draft,
                    ].join(" ")}>
                      {STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
                    {inv.sri_environment === "pruebas" ? (
                      <span className="rounded-sm border border-amber-500/30 bg-amber-500/5 px-1 font-mono text-[7.5px] font-bold uppercase text-amber-400">
                        Pruebas
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex gap-4 border-t border-steel-800/50 pt-2">
                  {inv.sale_id ? (
                    <Link
                      href={`/dashboard/pos/ventas/${inv.sale_id}#invoice`}
                      className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 hover:text-foreground"
                    >
                      Ver detalle →
                    </Link>
                  ) : null}
                  <a
                    href={`/api/invoices/${inv.id}/xml`}
                    download
                    className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/50 hover:text-foreground"
                  >
                    ↓ XML
                  </a>
                  {(inv.status === "authorized" || inv.status === "sent") && inv.sale_id ? (
                    <Link
                      href={`/print/pos/ventas/${inv.sale_id}?format=a4`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/50 hover:text-foreground"
                    >
                      ↗ A4
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <p className="font-mono text-[11px] text-muted-foreground/50">
            {filtered.length} de {invoices.length} comprobante{invoices.length !== 1 ? "s" : ""}
          </p>
        </>
      ) : null}
    </div>
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

function InvoiceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="13" y2="17" />
    </svg>
  );
}
