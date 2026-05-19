"use client";

/**
 * InvoiceCard — reusable electronic invoice document card.
 *
 * Handles all actions (emit draft, sign+send, recheck) internally.
 * Used in the sale detail page. Mount with id="invoice" for deep-link anchoring.
 */

import * as React from "react";
import Link       from "next/link";
import {
  generateInvoiceAction,
  processInvoiceAction,
  recheckAuthorizationAction,
} from "@/actions/invoices";
import type { ElectronicInvoiceRecord } from "@/lib/sri/types";

// ── Types ──────────────────────────────────────────────────────────────────

type SriError = { identificador: string; mensaje: string; tipo: string };

type Props = {
  invoice:  ElectronicInvoiceRecord | null;
  saleId:   string;
  canEmit:  boolean;
};

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  draft:      "Borrador",
  signed:     "Firmado",
  sent:       "Enviado al SRI",
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

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDatetime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-EC", {
    timeZone:  "America/Guayaquil",
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ── Main component ─────────────────────────────────────────────────────────

export function InvoiceCard({ invoice: initialInvoice, saleId, canEmit }: Props) {
  const [invoice,      setInvoice]      = React.useState(initialInvoice);
  const [loadingOp,    setLoadingOp]    = React.useState<"emit" | "process" | "recheck" | null>(null);
  const [error,        setError]        = React.useState<string | null>(null);
  const [sriErrors,    setSriErrors]    = React.useState<SriError[] | null>(null);
  const [success,      setSuccess]      = React.useState<string | null>(null);
  const [valErrors,    setValErrors]    = React.useState<string[]>([]);
  const [downloadingPdf, setDownloadingPdf] = React.useState(false);

  const status = invoice?.status ?? null;

  // ── Emit (generate draft) ──────────────────────────────────────────────
  async function handleEmit() {
    setLoadingOp("emit"); resetMessages();
    const res = await generateInvoiceAction(saleId);
    setLoadingOp(null);
    if (res?.error) {
      setError(res.error);
      if (res.validationErrors?.length) setValErrors(res.validationErrors);
      return;
    }
    if (res?.ok && res.invoice) {
      setInvoice(res.invoice);
      setSuccess("Borrador generado. Ahora puedes firmarlo y enviarlo al SRI.");
    }
  }

  // ── Process (sign → send → authorize) ─────────────────────────────────
  async function handleProcess() {
    if (!invoice?.id) return;
    setLoadingOp("process"); resetMessages();
    const res = await processInvoiceAction(invoice.id);
    setLoadingOp(null);
    if (res?.error) {
      setError(res.error);
      if (res.sriErrors?.length) setSriErrors(res.sriErrors);
      return;
    }
    if (res?.ok) {
      setSuccess(
        res.authorizationNumber
          ? `Autorizado · N° ${res.authorizationNumber}`
          : "Procesado correctamente",
      );
      setInvoice((prev) =>
        prev
          ? {
              ...prev,
              status:               (res.finalStatus ?? prev.status) as ElectronicInvoiceRecord["status"],
              authorization_number: res.authorizationNumber ?? prev.authorization_number,
              authorization_date:   res.authorizationDate   ?? prev.authorization_date,
            }
          : prev,
      );
    }
  }

  // ── Recheck (poll SRI for EN PROCESO) ─────────────────────────────────
  async function handleRecheck() {
    if (!invoice?.id) return;
    setLoadingOp("recheck"); resetMessages();
    const res = await recheckAuthorizationAction(invoice.id);
    setLoadingOp(null);
    if (res?.error) {
      setError(res.error);
      if (res.sriErrors?.length) setSriErrors(res.sriErrors);
      return;
    }
    if (res?.ok) {
      setSuccess(`Autorizado · N° ${res.authorizationNumber}`);
      setInvoice((prev) =>
        prev
          ? {
              ...prev,
              status:               "authorized",
              authorization_number: res.authorizationNumber ?? prev.authorization_number,
            }
          : prev,
      );
    }
  }

  function resetMessages() {
    setError(null); setSriErrors(null); setSuccess(null); setValErrors([]);
  }

  async function handleDownloadPdf() {
    if (!invoice?.id || downloadingPdf) return;
    setDownloadingPdf(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/pdf`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Error ${res.status} al generar el PDF.`);
      }
      const blob     = await res.blob();
      const envSufx  = invoice.sri_environment === "pruebas" ? "_pruebas" : "";
      const filename = `factura${envSufx}_${invoice.doc_number ?? invoice.id.slice(0, 8)}.pdf`;
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }

  const loading    = loadingOp !== null;
  const isPruebas  = invoice?.sri_environment === "pruebas";

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div id="invoice" className="rounded-sm border border-steel-700 bg-steel-900/60 overflow-hidden scroll-mt-8">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
            Factura Electrónica SRI
          </h3>
          {isPruebas ? (
            <span className="rounded-sm border border-amber-500/40 bg-amber-500/5 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-amber-400">
              Pruebas
            </span>
          ) : invoice ? (
            <span className="rounded-sm border border-emerald-600/40 bg-emerald-700/10 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.1em] text-emerald-400">
              Producción
            </span>
          ) : null}
        </div>
        {status && (
          <span className={[
            "rounded-sm border px-2 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em]",
            STATUS_COLORS[status] ?? STATUS_COLORS.draft,
          ].join(" ")}>
            {STATUS_LABELS[status] ?? status}
          </span>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">

        {/* ── No invoice yet ──────────────────────────────────────────── */}
        {!invoice && (
          <div className="space-y-3">
            <p className="font-mono text-[10.5px] text-muted-foreground/60">
              No se ha generado comprobante electrónico para esta venta.
            </p>
            {canEmit && (
              <ProcessButton
                loading={loadingOp === "emit"}
                onClick={handleEmit}
              >
                Emitir factura electrónica
              </ProcessButton>
            )}
          </div>
        )}

        {/* ── Invoice metadata ────────────────────────────────────────── */}
        {invoice && (
          <div className="space-y-1.5">
            <MetaRow label="N° comprobante"    value={invoice.doc_number ?? "—"} />
            <MetaRow
              label="Clave de acceso"
              value={invoice.access_key ? `${invoice.access_key.slice(0, 20)}…` : "—"}
              mono
              title={invoice.access_key ?? undefined}
            />
            <MetaRow label="Ambiente"          value={isPruebas ? "Pruebas" : "Producción"} />
            {invoice.authorization_number ? (
              <MetaRow label="N° autorización" value={invoice.authorization_number} mono />
            ) : null}
            {invoice.authorization_date ? (
              <MetaRow label="Fecha autorización" value={fmtDatetime(invoice.authorization_date)} />
            ) : null}
            <MetaRow label="Creado"            value={fmtDatetime(invoice.created_at)} />
          </div>
        )}

        {/* ── SRI errors ──────────────────────────────────────────────── */}
        {(() => {
          const errs = sriErrors ?? (invoice?.sri_errors as SriError[] | null | undefined);
          if (!errs?.length) return null;
          return (
            <div className="rounded-sm border border-red-500/30 bg-red-500/5 px-3 py-2 space-y-1">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-red-400/80">
                Errores SRI
              </p>
              {errs.map((e, i) => (
                <div key={i} className="text-[10.5px]">
                  <span className="font-mono text-[9px] text-red-400/60">[{e.identificador}] </span>
                  <span className="text-red-400/80">{e.mensaje}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── Validation errors ───────────────────────────────────────── */}
        {valErrors.length > 0 ? (
          <div className="rounded-sm border border-amber-500/30 bg-amber-500/5 px-3 py-2 space-y-1">
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-amber-400/80">
              Errores de validación
            </p>
            {valErrors.map((e, i) => (
              <p key={i} className="font-mono text-[10.5px] text-amber-400/80">{e}</p>
            ))}
          </div>
        ) : null}

        {/* ── Success ─────────────────────────────────────────────────── */}
        {success ? (
          <div className="rounded-sm border border-signal-600/30 bg-signal-700/10 px-3 py-2">
            <p className="font-mono text-[10.5px] text-signal-400">✓ {success}</p>
          </div>
        ) : null}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {error ? (
          <div className="rounded-sm border border-red-500/30 bg-red-500/5 px-3 py-2">
            <p className="font-mono text-[10.5px] text-red-400">{error}</p>
          </div>
        ) : null}

        {/* ── Environment warning ─────────────────────────────────────── */}
        {isPruebas && status !== "authorized" ? (
          <p className="font-mono text-[9px] text-amber-400/60">
            ⚠ Ambiente de pruebas — los comprobantes no tienen validez tributaria.
          </p>
        ) : null}
        {isPruebas && status === "authorized" ? (
          <p className="font-mono text-[9px] text-amber-400/60">
            ⚠ Comprobante de pruebas — válido como documento técnico, sin efecto tributario.
          </p>
        ) : null}

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-t border-steel-800/50 pt-3">

          {/* Sign + send: draft / signed / rejected */}
          {canEmit && invoice && status != null && (["draft", "signed", "rejected"] as string[]).includes(status) ? (
            <ProcessButton loading={loadingOp === "process"} onClick={handleProcess}>
              {status === "rejected" ? "Reintentar envío SRI" : "Firmar y enviar al SRI"}
            </ProcessButton>
          ) : null}

          {/* Recheck: sent */}
          {canEmit && invoice && (status as string) === "sent" ? (
            <ProcessButton loading={loadingOp === "recheck"} onClick={handleRecheck} secondary>
              Verificar autorización SRI
            </ProcessButton>
          ) : null}

          {/* XML download */}
          {invoice ? (
            <a
              href={`/api/invoices/${invoice.id}/xml`}
              download
              className={[
                "flex h-8 items-center gap-1.5 rounded-sm border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
                "border-steel-600/60 bg-steel-800/30 text-muted-foreground/70 hover:border-steel-500 hover:text-foreground",
                loading ? "pointer-events-none opacity-40" : "",
              ].join(" ")}
            >
              <DownloadIcon className="h-3 w-3" />
              XML
            </a>
          ) : null}

          {/* Print Ticket — always available; ticket de venta no depende del SRI */}
          <Link
            href={`/print/pos/ventas/${saleId}?format=ticket`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 items-center gap-1.5 rounded-sm border border-steel-600/60 bg-steel-800/30 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70 transition-colors hover:border-steel-500 hover:text-foreground"
          >
            <PrinterIcon className="h-3 w-3" />
            Ticket
          </Link>

          {/* Print A4 — nota de venta formal, siempre disponible */}
          <Link
            href={`/print/pos/ventas/${saleId}?format=a4`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 items-center gap-1.5 rounded-sm border border-steel-600/60 bg-steel-800/30 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70 transition-colors hover:border-steel-500 hover:text-foreground"
          >
            <PrinterIcon className="h-3 w-3" />
            A4
          </Link>

          {/* RIDE HTML — disponible cuando hay invoice con doc_number */}
          {invoice?.doc_number ? (
            <Link
              href={`/print/pos/ventas/${saleId}?format=ride`}
              target="_blank"
              rel="noopener noreferrer"
              className={[
                "flex h-8 items-center gap-1.5 rounded-sm border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
                "border-emerald-700/50 bg-emerald-900/20 text-emerald-400/80 hover:border-emerald-600 hover:text-emerald-300",
                loading ? "pointer-events-none opacity-40" : "",
              ].join(" ")}
            >
              <PrinterIcon className="h-3 w-3" />
              RIDE
            </Link>
          ) : null}

          {/* PDF download — programmatic to show loading/error feedback */}
          {invoice?.doc_number ? (
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={loading || downloadingPdf}
              className={[
                "flex h-8 items-center gap-1.5 rounded-sm border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
                "border-emerald-700/50 bg-emerald-900/20 text-emerald-400/80 hover:border-emerald-600 hover:text-emerald-300",
                (loading || downloadingPdf) ? "cursor-not-allowed opacity-50" : "",
              ].join(" ")}
            >
              {downloadingPdf
                ? <SpinnerIcon className="h-3 w-3 animate-spin" />
                : <DownloadIcon className="h-3 w-3" />}
              {downloadingPdf ? "Generando…" : "PDF"}
            </button>
          ) : null}

          {/* Signed status hint */}
          {(status as string) === "signed" ? (
            <span className="font-mono text-[9.5px] text-sky-400/60">
              XML firmado · pendiente de envío al SRI
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MetaRow({
  label, value, mono, title,
}: {
  label:  string;
  value:  string;
  mono?:  boolean;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/50 shrink-0">
        {label}
      </span>
      <span
        title={title}
        className={[
          "truncate text-[10.5px] text-foreground/80",
          mono ? "font-mono" : "",
          title ? "cursor-help" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

function ProcessButton({
  loading, onClick, secondary, children,
}: {
  loading:    boolean;
  onClick:    () => void;
  secondary?: boolean;
  children:   React.ReactNode;
}) {
  const cls = secondary
    ? "border-sky-600/40 bg-sky-700/10 text-sky-400 hover:bg-sky-700/20"
    : "border-safety-500/50 bg-safety-500/10 text-safety-500 hover:bg-safety-500/20";
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={[
        "flex h-8 items-center gap-1.5 rounded-sm border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
        cls,
        loading ? "cursor-not-allowed opacity-60" : "",
      ].join(" ")}
    >
      {loading ? (
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : null}
      {children}
    </button>
  );
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

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function PrinterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
