"use client";

import * as React from "react";
import { processInvoiceAction, recheckAuthorizationAction } from "@/actions/invoices";
import type { ElectronicInvoiceRecord } from "@/lib/sri/types";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  saleId:   string;
  invoice:  ElectronicInvoiceRecord | null;
  canEmit:  boolean;   // only owner / admin
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
  draft:      "border-steel-600/50 text-muted-foreground/70",
  signed:     "border-sky-600/40 bg-sky-700/10 text-sky-400",
  sent:       "border-safety-500/40 bg-safety-500/5 text-safety-400",
  authorized: "border-signal-600/40 bg-signal-700/10 text-signal-400",
  rejected:   "border-red-500/40 bg-red-500/5 text-red-400",
  cancelled:  "border-steel-700 text-muted-foreground/50",
};

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtDatetime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ── Component ──────────────────────────────────────────────────────────────

export function InvoicePanel({ saleId, invoice: initialInvoice, canEmit }: Props) {
  const [invoice, setInvoice] = React.useState(initialInvoice);
  const [loading,  setLoading]  = React.useState(false);
  const [error,    setError]    = React.useState<string | null>(null);
  const [sriErrors, setSriErrors] = React.useState<{ identificador: string; mensaje: string; tipo: string }[] | null>(null);
  const [success,  setSuccess]  = React.useState<string | null>(null);

  const status = invoice?.status ?? null;

  // ── Process (sign → send → authorize) ────────────────────────────────
  async function handleProcess() {
    if (!invoice?.id || !canEmit) return;
    setLoading(true); setError(null); setSriErrors(null); setSuccess(null);

    const result = await processInvoiceAction(invoice.id);
    setLoading(false);

    if (result?.error) {
      setError(result.error);
      if (result.sriErrors?.length) setSriErrors(result.sriErrors);
      return;
    }

    if (result?.ok) {
      setSuccess(
        result.authorizationNumber
          ? `Autorizado · N° ${result.authorizationNumber}`
          : "Procesado correctamente"
      );
      // Refresh the invoice data from the server (server will revalidate)
      setInvoice((prev) =>
        prev
          ? {
              ...prev,
              status:               (result.finalStatus ?? prev.status) as ElectronicInvoiceRecord["status"],
              authorization_number: result.authorizationNumber ?? prev.authorization_number,
              authorization_date:   result.authorizationDate   ?? prev.authorization_date,
            }
          : prev
      );
    }
  }

  // ── Recheck authorization ─────────────────────────────────────────────
  async function handleRecheck() {
    if (!invoice?.id || !canEmit) return;
    setLoading(true); setError(null); setSriErrors(null); setSuccess(null);

    const result = await recheckAuthorizationAction(invoice.id);
    setLoading(false);

    if (result?.error) {
      setError(result.error);
      if (result.sriErrors?.length) setSriErrors(result.sriErrors);
      return;
    }

    if (result?.ok) {
      setSuccess(`Autorizado · N° ${result.authorizationNumber}`);
      setInvoice((prev) =>
        prev
          ? {
              ...prev,
              status:               "authorized" as ElectronicInvoiceRecord["status"],
              authorization_number: result.authorizationNumber ?? prev.authorization_number,
            }
          : prev
      );
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="rounded-sm border border-steel-700 bg-steel-900/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-4 py-2.5">
        <h3 className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
          Factura Electrónica SRI
        </h3>
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
        {/* No invoice yet */}
        {!invoice && (
          <p className="font-mono text-[10.5px] text-muted-foreground/60">
            No se ha generado comprobante electrónico para esta venta.
          </p>
        )}

        {/* Invoice details */}
        {invoice && (
          <div className="space-y-1.5">
            <MetaRow label="N° comprobante" value={invoice.doc_number ?? "—"} />
            <MetaRow label="Clave acceso"   value={invoice.access_key ? invoice.access_key.slice(0, 24) + "…" : "—"} mono />
            <MetaRow label="Ambiente"       value={invoice.sri_environment === "produccion" ? "Producción" : "Pruebas"} />
            {invoice.authorization_number && (
              <MetaRow label="N° autorización" value={invoice.authorization_number} mono />
            )}
            {invoice.authorization_date && (
              <MetaRow label="Fecha autorización" value={fmtDatetime(invoice.authorization_date)} />
            )}
            <MetaRow label="Creado"         value={fmtDatetime(invoice.created_at)} />
          </div>
        )}

        {/* SRI errors — shown when status = rejected */}
        {(sriErrors ?? (invoice?.sri_errors as typeof sriErrors))?.length ? (
          <div className="rounded-sm border border-red-500/30 bg-red-500/5 px-3 py-2 space-y-1">
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-red-400/80">
              Errores SRI
            </p>
            {(sriErrors ?? (invoice?.sri_errors as typeof sriErrors))!.map((e, i) => (
              <div key={i} className="text-[10.5px]">
                <span className="font-mono text-[9px] text-red-400/60">[{e.identificador}] </span>
                <span className="text-red-400/80">{e.mensaje}</span>
              </div>
            ))}
          </div>
        ) : null}

        {/* Success message */}
        {success && (
          <div className="rounded-sm border border-signal-600/30 bg-signal-700/10 px-3 py-2">
            <p className="font-mono text-[10.5px] text-signal-400">
              ✓ {success}
            </p>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="rounded-sm border border-red-500/30 bg-red-500/5 px-3 py-2">
            <p className="font-mono text-[10.5px] text-red-400">{error}</p>
          </div>
        )}

        {/* Environment warning */}
        {invoice?.sri_environment === "pruebas" && status !== "authorized" && (
          <p className="font-mono text-[9px] text-amber-400/60">
            ⚠ Ambiente de pruebas — los comprobantes no tienen validez tributaria.
          </p>
        )}

        {/* Actions */}
        {canEmit && (
          <div className="flex flex-wrap gap-2 border-t border-steel-800/50 pt-3">
            {/* Generate draft — only if no invoice exists */}
            {!invoice && (
              <a
                href={`/dashboard/pos/ventas/${saleId}`}
                className="font-mono text-[10px] text-muted-foreground/60 hover:text-foreground"
              >
                Genera el borrador desde &quot;Generar factura&quot; arriba
              </a>
            )}

            {/* Process — from draft, signed, or rejected */}
            {invoice && status != null && (["draft", "signed", "rejected"] as string[]).includes(status) && (
              <ProcessButton loading={loading} onClick={handleProcess}>
                {status === "rejected" ? "Reintentar envío SRI" : "Firmar y enviar al SRI"}
              </ProcessButton>
            )}

            {/* Recheck — from sent (EN PROCESO case) */}
            {invoice && (status as string) === "sent" && (
              <ProcessButton loading={loading} onClick={handleRecheck} secondary>
                Verificar autorización SRI
              </ProcessButton>
            )}

            {/* Send again if signed but not sent */}
            {invoice && (status as string) === "signed" && (
              <span className="font-mono text-[9.5px] text-sky-400/60">
                XML firmado · pendiente de envío al SRI
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/50 shrink-0">
        {label}
      </span>
      <span className={[
        "truncate text-[10.5px] text-foreground/80",
        mono ? "font-mono" : "",
      ].join(" ")}>
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
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onClick}
      className={[
        "flex h-8 items-center gap-1.5 rounded-sm border px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
        secondary
          ? "border-sky-600/40 bg-sky-700/10 text-sky-400 hover:bg-sky-700/20"
          : "border-safety-500/50 bg-safety-500/10 text-safety-500 hover:bg-safety-500/20",
        loading ? "cursor-not-allowed opacity-60" : "",
      ].join(" ")}
    >
      {loading ? (
        <span className="flex items-center gap-1.5">
          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          Procesando...
        </span>
      ) : children}
    </button>
  );
}
