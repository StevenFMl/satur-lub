/**
 * Ecuador SRI — invoice processing pipeline.
 *
 * Orchestrates: sign → send → authorize → persist
 *
 * Status transitions:
 *   draft → signed → sent → authorized
 *                         → rejected (with sri_errors)
 *
 * Retry strategy for authorization:
 *   After a RECIBIDA reception, poll authorization up to MAX_AUTH_RETRIES
 *   times with AUTH_RETRY_DELAY_MS between attempts. If still EN PROCESO,
 *   leave status as 'sent' and allow manual re-check via the UI.
 */

import { loadCertificate }   from "./cert";
import { signXml }           from "./signer";
import { sendToReception, queryAuthorization } from "./soap-client";
import type { SriErrorItem } from "./soap-client";
import type { ElectronicInvoiceStatus } from "./types";

// ── Config ─────────────────────────────────────────────────────────────────

const MAX_AUTH_RETRIES   = 3;
const AUTH_RETRY_DELAY   = 2_500; // ms between authorization polls

// ── Types ──────────────────────────────────────────────────────────────────

export type PipelineInput = {
  invoiceId:    string;
  accessKey:    string;
  xmlUnsigned:  string;
  environment:  "pruebas" | "produccion";
  /** Tenant UUID — used to resolve the correct signing certificate. */
  tenantId:     string;
};

export type PipelineOutput = {
  ok:                  boolean;
  finalStatus:         ElectronicInvoiceStatus;
  xmlSigned?:          string;
  signingTime?:        string;
  authorizationNumber?: string;
  authorizationDate?:  string;
  errors:              SriErrorItem[];
  phase:               "sign" | "send" | "authorize" | "done";
  message?:            string;
};

// ── Sleep helper ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main pipeline ──────────────────────────────────────────────────────────

/**
 * Runs the full sign → send → authorize pipeline for one invoice.
 *
 * This function does NOT write to the DB — the caller (server action)
 * is responsible for persisting each status transition.
 *
 * @returns PipelineOutput describing the final state after the pipeline run.
 */
export async function runInvoicePipeline(
  input: PipelineInput
): Promise<PipelineOutput> {
  const { xmlUnsigned, environment, tenantId } = input;

  // ── Phase 1: Sign ──────────────────────────────────────────────────────
  const certResult = await loadCertificate(tenantId);
  if (!certResult.ok) {
    return {
      ok: false, finalStatus: "draft",
      errors: [{ identificador: "CERT", mensaje: certResult.error, informacionAdicional: null, tipo: "ERROR" }],
      phase: "sign",
    };
  }

  const signResult = signXml(xmlUnsigned, certResult.cert);
  if (!signResult.ok) {
    return {
      ok: false, finalStatus: "draft",
      errors: [{ identificador: "SIGN", mensaje: signResult.error, informacionAdicional: null, tipo: "ERROR" }],
      phase: "sign",
    };
  }

  const { signedXml, signingTime } = signResult;

  // ── Phase 2: Send to SRI reception ────────────────────────────────────
  const recResult = await sendToReception(signedXml, environment);

  if (!recResult.ok) {
    // DEVUELTA or network error — the document was rejected before processing
    return {
      ok: false, finalStatus: "rejected",
      xmlSigned: signedXml, signingTime,
      errors: recResult.errors,
      phase: "send",
      message: `SRI rechazó el comprobante (${recResult.estado}).`,
    };
  }

  // ── Phase 3: Poll for authorization ───────────────────────────────────
  let authResult: Awaited<ReturnType<typeof queryAuthorization>> | null = null;

  for (let attempt = 1; attempt <= MAX_AUTH_RETRIES; attempt++) {
    await sleep(AUTH_RETRY_DELAY);
    authResult = await queryAuthorization(input.accessKey, environment);

    if (authResult.estado !== "EN PROCESO") break;

    // Log retry attempts to server console (visible in Vercel logs)
    console.log(
      `[SRI pipeline] invoice ${input.invoiceId}: authorization EN PROCESO, ` +
      `attempt ${attempt}/${MAX_AUTH_RETRIES}`
    );
  }

  if (!authResult) {
    // Should not happen — loop always assigns authResult at least once
    return {
      ok: false, finalStatus: "sent",
      xmlSigned: signedXml, signingTime,
      errors: [],
      phase: "authorize",
      message: "No se pudo obtener respuesta de autorización. Reintenta desde el detalle de la venta.",
    };
  }

  if (authResult.estado === "AUTORIZADO") {
    return {
      ok: true, finalStatus: "authorized",
      xmlSigned: signedXml, signingTime,
      authorizationNumber: authResult.numeroAutorizacion ?? undefined,
      authorizationDate:   authResult.fechaAutorizacion  ?? undefined,
      errors: authResult.errors,
      phase: "done",
    };
  }

  if (authResult.estado === "EN PROCESO") {
    // Still pending after all retries — leave as 'sent' for manual retry
    return {
      ok: false, finalStatus: "sent",
      xmlSigned: signedXml, signingTime,
      errors: [],
      phase: "authorize",
      message:
        "El SRI está procesando el comprobante. Reintenta la verificación en unos segundos " +
        "desde el detalle de la venta.",
    };
  }

  // NO AUTORIZADO or ERROR_RED
  return {
    ok: false, finalStatus: "rejected",
    xmlSigned: signedXml, signingTime,
    errors: authResult.errors,
    phase: "authorize",
    message: `SRI no autorizó el comprobante (${authResult.estado}).`,
  };
}
