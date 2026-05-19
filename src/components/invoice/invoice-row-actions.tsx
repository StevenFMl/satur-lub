"use client";

/**
 * InvoiceRowActions — compact invoice actions for sales list rows.
 *
 * Shows status badge + download/print links + mutating actions
 * (emit, process, recheck). Calls router.refresh() after mutations
 * so the server component re-fetches the updated list.
 */

import * as React  from "react";
import Link        from "next/link";
import { useRouter } from "next/navigation";
import {
  generateInvoiceAction,
  processInvoiceAction,
  recheckAuthorizationAction,
} from "@/actions/invoices";

// ── Types ──────────────────────────────────────────────────────────────────

export type InvoiceRowData = {
  invoiceId:     string | null;
  invoiceStatus: string | null;
  docNumber:     string | null;
  env:           string | null;
};

type Props = {
  saleId:  string;
  invoice: InvoiceRowData;
  canEmit: boolean;
};

// ── Status config ──────────────────────────────────────────────────────────

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

// ── Component ──────────────────────────────────────────────────────────────

export function InvoiceRowActions({ saleId, invoice, canEmit }: Props) {
  const router = useRouter();

  const [busy, setBusy] = React.useState<"emit" | "process" | "recheck" | null>(null);
  const [err,  setErr]  = React.useState<string | null>(null);

  const { invoiceId, invoiceStatus: status, docNumber, env } = invoice;

  async function handleEmit() {
    setBusy("emit"); setErr(null);
    const res = await generateInvoiceAction(saleId);
    setBusy(null);
    if (res?.error) { setErr(res.error); return; }
    router.refresh();
  }

  async function handleProcess() {
    if (!invoiceId) return;
    setBusy("process"); setErr(null);
    const res = await processInvoiceAction(invoiceId);
    setBusy(null);
    if (res?.error) { setErr(res.error); return; }
    router.refresh();
  }

  async function handleRecheck() {
    if (!invoiceId) return;
    setBusy("recheck"); setErr(null);
    const res = await recheckAuthorizationAction(invoiceId);
    setBusy(null);
    if (res?.error) { setErr(res.error); return; }
    router.refresh();
  }

  // ── No invoice ────────────────────────────────────────────────────────
  if (!invoiceId && !status) {
    return (
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[9px] text-muted-foreground/30">Sin comprobante SRI</span>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/print/pos/ventas/${saleId}?format=ticket`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            ↗ Ticket
          </Link>
          <Link
            href={`/print/pos/ventas/${saleId}?format=a4`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            ↗ A4
          </Link>
          {canEmit ? (
            <MiniButton
              onClick={handleEmit}
              loading={busy === "emit"}
              variant="primary"
            >
              Emitir
            </MiniButton>
          ) : null}
        </div>
        {err ? <ErrorHint msg={err} /> : null}
      </div>
    );
  }

  // ── Has invoice ───────────────────────────────────────────────────────
  const colorCls = STATUS_COLORS[status ?? "draft"] ?? STATUS_COLORS.draft;
  const label    = STATUS_LABELS[status ?? "draft"] ?? status;

  return (
    <div className="space-y-1 min-w-[140px]">
      {/* Status badge — links to invoice section in sale detail */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Link
          href={`/dashboard/pos/ventas/${saleId}#invoice`}
          className={[
            "rounded-sm border px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] transition-opacity hover:opacity-70",
            colorCls,
          ].join(" ")}
          title="Ver comprobante en detalle de venta"
        >
          {label}
        </Link>
        {env === "pruebas" ? (
          <span
            title="Ambiente de pruebas — sin validez tributaria"
            className="rounded-sm border border-amber-500/30 bg-amber-500/5 px-1 font-mono text-[7.5px] font-bold uppercase text-amber-400/70"
          >
            P
          </span>
        ) : null}
      </div>

      {/* Doc number */}
      {docNumber ? (
        <p className="font-mono text-[9px] tabular-nums text-muted-foreground/40 leading-none">
          {docNumber}
        </p>
      ) : null}

      {/* Mutating actions (owner/admin only) */}
      {canEmit ? (
        <div className="flex flex-wrap items-center gap-1">
          {status && (["draft", "signed", "rejected"] as string[]).includes(status) ? (
            <MiniButton onClick={handleProcess} loading={busy === "process"} variant="primary">
              {status === "rejected" ? "Reintentar" : "Firmar+Enviar"}
            </MiniButton>
          ) : null}
          {status === "sent" ? (
            <MiniButton onClick={handleRecheck} loading={busy === "recheck"} variant="secondary">
              Verificar
            </MiniButton>
          ) : null}
        </div>
      ) : null}

      {/* Download / print links — available to all roles */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <Link
          href={`/print/pos/ventas/${saleId}?format=ticket`}
          target="_blank"
          rel="noopener noreferrer"
          title="Imprimir ticket 80mm"
          className="font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          ↗ Ticket
        </Link>
        <Link
          href={`/print/pos/ventas/${saleId}?format=a4`}
          target="_blank"
          rel="noopener noreferrer"
          title="Imprimir A4 / RIDE"
          className="font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          ↗ A4
        </Link>
        {invoiceId ? (
          <a
            href={`/api/invoices/${invoiceId}/xml`}
            download
            title="Descargar XML firmado"
            className="font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            ↓ XML
          </a>
        ) : null}
        <Link
          href={`/dashboard/pos/ventas/${saleId}#invoice`}
          className="font-mono text-[9px] uppercase tracking-[0.06em] text-muted-foreground/40 hover:text-foreground transition-colors"
        >
          Ver →
        </Link>
      </div>

      {err ? <ErrorHint msg={err} /> : null}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MiniButton({
  onClick, loading, variant, children,
}: {
  onClick:  () => void;
  loading:  boolean;
  variant:  "primary" | "secondary";
  children: React.ReactNode;
}) {
  const cls = variant === "primary"
    ? "border-safety-500/50 bg-safety-500/10 text-safety-500 hover:bg-safety-500/20"
    : "border-sky-600/40 bg-sky-700/10 text-sky-400 hover:bg-sky-700/20";
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={[
        "flex h-5 items-center gap-0.5 rounded-sm border px-1.5 font-mono text-[8px] font-bold uppercase tracking-[0.08em] transition-colors",
        cls,
        loading ? "cursor-not-allowed opacity-60" : "",
      ].join(" ")}
    >
      {loading ? (
        <svg className="h-2 w-2 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : null}
      {children}
    </button>
  );
}

function ErrorHint({ msg }: { msg: string }) {
  return (
    <p
      className="font-mono text-[8.5px] text-red-400 leading-tight"
      title={msg}
    >
      ✕ {msg.length > 50 ? msg.slice(0, 50) + "…" : msg}
    </p>
  );
}
