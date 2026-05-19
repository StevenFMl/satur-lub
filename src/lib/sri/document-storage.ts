/**
 * document-storage.ts — Supabase Storage helpers for fiscal documents.
 *
 * All operations use createAdminClient() (service_role key) so they
 * bypass RLS. Permission checks happen at the server-action level
 * before these helpers are called.
 *
 * Path convention (single private bucket "documentos-fiscales"):
 *   invoices : {tenant_id}/{estab}-{pto_emi}/invoices/{yyyy}/{mm}/{access_key}.xml
 *   rides    : {tenant_id}/{estab}-{pto_emi}/rides/{yyyy}/{mm}/{access_key}.pdf
 *   prints   : {tenant_id}/{estab}-{pto_emi}/prints/{yyyy}/{mm}/VENTA-{sale_id}.pdf
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// ── Constants ──────────────────────────────────────────────────────────────

export const FISCAL_DOCS_BUCKET = "documentos-fiscales";

// ── Param types ────────────────────────────────────────────────────────────

export type InvoiceDocParams = {
  tenantId:  string;   // UUID
  estab:     string;   // "001"
  ptoEmi:    string;   // "001"
  accessKey: string;   // 49-char SRI access key
  date:      string;   // "YYYY-MM-DD" — used only for yyyy/mm folder
};

export type PrintDocParams = {
  tenantId: string;
  estab:    string;
  ptoEmi:   string;
  saleId:   string;
  date:     string;
};

// ── Internal utils ─────────────────────────────────────────────────────────

function branch(estab: string, ptoEmi: string): string {
  return `${estab}-${ptoEmi}`;
}

function ym(date: string): string {
  // date = "YYYY-MM-DD" → folder "YYYY/MM"
  const [yyyy, mm] = date.split("-");
  const y = yyyy ?? new Date().getFullYear().toString();
  const m = mm   ?? String(new Date().getMonth() + 1).padStart(2, "0");
  return `${y}/${m}`;
}

// ── Path builders (pure — no I/O) ──────────────────────────────────────────

/**
 * {tenant_id}/{estab}-{pto_emi}/invoices/{yyyy}/{mm}/{access_key}.xml
 */
export function buildXmlStoragePath(p: InvoiceDocParams): string {
  return `${p.tenantId}/${branch(p.estab, p.ptoEmi)}/invoices/${ym(p.date)}/${p.accessKey}.xml`;
}

/**
 * {tenant_id}/{estab}-{pto_emi}/rides/{yyyy}/{mm}/{access_key}.pdf
 */
export function buildRideStoragePath(p: InvoiceDocParams): string {
  return `${p.tenantId}/${branch(p.estab, p.ptoEmi)}/rides/${ym(p.date)}/${p.accessKey}.pdf`;
}

/**
 * {tenant_id}/{estab}-{pto_emi}/prints/{yyyy}/{mm}/VENTA-{sale_id}.pdf
 */
export function buildPrintStoragePath(p: PrintDocParams): string {
  return `${p.tenantId}/${branch(p.estab, p.ptoEmi)}/prints/${ym(p.date)}/VENTA-${p.saleId}.pdf`;
}

// ── Upload result ──────────────────────────────────────────────────────────

export type StorageUploadResult =
  | { ok: true;  path: string }
  | { ok: false; error: string };

// ── Uploads ────────────────────────────────────────────────────────────────

/**
 * Upload the signed XML for a comprobante.
 *
 * Uses upsert=true — safe to call again on pipeline retries without
 * leaving duplicate files. Storage path is stored in electronic_invoices
 * .xml_storage_path after a successful upload.
 */
export async function uploadInvoiceXml(
  params:     InvoiceDocParams,
  xmlContent: string,
): Promise<StorageUploadResult> {
  const path  = buildXmlStoragePath(params);
  const admin = createAdminClient();

  const { error } = await admin.storage
    .from(FISCAL_DOCS_BUCKET)
    .upload(path, new TextEncoder().encode(xmlContent), {
      contentType:  "application/xml; charset=utf-8",
      upsert:       true,
      cacheControl: "3600",
    });

  if (error) {
    console.error("[document-storage] uploadInvoiceXml failed:", path, error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, path };
}

/**
 * Upload a RIDE/print PDF.
 * Not yet used (PDF generation pending); reserved for future integration.
 */
export async function uploadRidePdf(
  params:   InvoiceDocParams,
  pdfBytes: Uint8Array | ArrayBuffer | Blob,
): Promise<StorageUploadResult> {
  const path  = buildRideStoragePath(params);
  const admin = createAdminClient();

  const { error } = await admin.storage
    .from(FISCAL_DOCS_BUCKET)
    .upload(path, pdfBytes, {
      contentType:  "application/pdf",
      upsert:       true,
      cacheControl: "3600",
    });

  if (error) {
    console.error("[document-storage] uploadRidePdf failed:", path, error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, path };
}

// ── Signed URL ─────────────────────────────────────────────────────────────

/**
 * Generate a time-limited signed URL for any stored document.
 *
 * Returns null when the path doesn't exist or signing fails — callers
 * should fall back to the API route (which serves the DB copy).
 *
 * @param path       Storage path from xml_storage_path / pdf_storage_path DB column.
 * @param expiresIn  Seconds until URL expires. 300 s (5 min) is enough for
 *                   a browser to start and finish the download.
 */
export async function getSignedDocumentUrl(
  path:      string,
  expiresIn: number = 300,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(FISCAL_DOCS_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    // Not necessarily a hard error — path may not exist yet for older invoices
    return null;
  }
  return data.signedUrl;
}

// ── Convenience resolver ───────────────────────────────────────────────────

/**
 * Resolve the best download URL for an invoice's signed XML.
 *
 * Strategy:
 *   1. If xml_storage_path is set → generate 5-min signed URL from Storage.
 *   2. Otherwise → API route that streams xml_signed from the DB column.
 *
 * Both paths produce an identical file; Storage is preferred when available
 * because it's served from Supabase CDN without hitting the Next.js server.
 */
export async function resolveXmlDownloadUrl(invoice: {
  id:               string;
  xml_storage_path: string | null | undefined;
}): Promise<string> {
  if (invoice.xml_storage_path) {
    const url = await getSignedDocumentUrl(invoice.xml_storage_path, 300);
    if (url) return url;
  }
  return `/api/invoices/${invoice.id}/xml`;
}

/**
 * Resolve the best download URL for an invoice's RIDE PDF.
 *
 * Strategy:
 *   1. If pdf_storage_path is set → try a 10-min signed URL from Storage.
 *      10 min allows large PDFs to download fully on slow connections.
 *   2. If Storage signing fails or path not set → return null so the
 *      caller falls back to live PDF generation via /api/invoices/{id}/pdf.
 */
export async function resolvePdfDownloadUrl(invoice: {
  id:               string;
  pdf_storage_path: string | null | undefined;
}): Promise<string | null> {
  if (invoice.pdf_storage_path) {
    const url = await getSignedDocumentUrl(invoice.pdf_storage_path, 600);
    if (url) return url;
  }
  return null; // caller uses /api/invoices/{id}/pdf (live generation)
}

// ── DB metadata helpers ────────────────────────────────────────────────────

/**
 * Persist pdf_storage_path on an electronic_invoices row.
 * Fire-and-forget — logs a warning on failure rather than throwing.
 */
export async function savePdfStoragePath(
  invoiceId: string,
  path:      string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await (admin as any)
    .from("electronic_invoices")
    .update({ pdf_storage_path: path })
    .eq("id", invoiceId);

  if (error) {
    console.warn("[document-storage] savePdfStoragePath failed:", invoiceId, error.message);
  }
}

// ── Audit trail ────────────────────────────────────────────────────────────

export type DocumentEventParams = {
  tenantId:    string;
  invoiceId?:  string;
  saleId?:     string;
  userId?:     string;
  docType:     "xml" | "pdf" | "ride_html" | "ticket" | "a4";
  eventType:   "generate" | "download" | "storage_upload";
  status:      "ok" | "error";
  errorMsg?:   string;
  storagePath?: string;
};

/**
 * Write a document event to the audit log.
 * Always fire-and-forget — never throws; never blocks the response.
 */
export function logDocumentEvent(params: DocumentEventParams): void {
  const admin = createAdminClient();
  (admin as any)
    .from("document_events")
    .insert({
      tenant_id:    params.tenantId,
      invoice_id:   params.invoiceId   ?? null,
      sale_id:      params.saleId      ?? null,
      user_id:      params.userId      ?? null,
      doc_type:     params.docType,
      event_type:   params.eventType,
      status:       params.status,
      error_msg:    params.errorMsg    ?? null,
      storage_path: params.storagePath ?? null,
    })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn("[document-storage] logDocumentEvent failed:", error.message);
    });
}
