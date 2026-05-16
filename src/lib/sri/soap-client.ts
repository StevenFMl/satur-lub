/**
 * Ecuador SRI — SOAP client for reception and authorization.
 *
 * Two operations:
 *   sendToReception()     — Submits the signed XML to the SRI reception endpoint.
 *                           Returns: RECIBIDA | DEVUELTA (with errors)
 *   queryAuthorization()  — Queries the SRI authorization endpoint by access key.
 *                           Returns: AUTORIZADO | NO AUTORIZADO | EN PROCESO
 *
 * Uses native fetch (Node.js 18+). No SOAP library is needed — the SRI endpoints
 * have simple envelopes that are safe to construct with template strings.
 */

import { SRI_WSDL } from "./constants";

// ── Types ──────────────────────────────────────────────────────────────────

export type SriErrorItem = {
  identificador:        string;
  mensaje:              string;
  informacionAdicional: string | null;
  tipo:                 "ERROR" | "ADVERTENCIA";
};

export type ReceptionResult = {
  ok:     boolean;  // true = RECIBIDA, false = DEVUELTA or network error
  estado: "RECIBIDA" | "DEVUELTA" | "ERROR_RED";
  errors: SriErrorItem[];
  raw?:   string;   // raw SOAP response for debugging
};

export type AuthorizationResult = {
  ok:                  boolean;
  estado:              "AUTORIZADO" | "NO AUTORIZADO" | "EN PROCESO" | "ERROR_RED";
  numeroAutorizacion:  string | null;
  fechaAutorizacion:   string | null;
  errors:              SriErrorItem[];
  raw?:                string;
};

// ── XML parsing helpers ────────────────────────────────────────────────────
// Simple extraction from SOAP responses — format is predictable and stable.

function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? null;
}

function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) matches.push(m[1].trim());
  }
  return matches;
}

function parseSriErrors(xml: string): SriErrorItem[] {
  const mensajes = extractAllTags(xml, "mensaje");
  return mensajes.map((m) => ({
    identificador:        extractTag(m, "identificador") ?? "",
    mensaje:              extractTag(m, "mensaje") ?? m.slice(0, 200),
    informacionAdicional: extractTag(m, "informacionAdicional"),
    tipo:                 (extractTag(m, "tipo") ?? "ERROR").toUpperCase() === "ADVERTENCIA"
                            ? "ADVERTENCIA"
                            : "ERROR",
  }));
}

// ── SOAP envelope builders ─────────────────────────────────────────────────

function buildReceptionEnvelope(signedXmlBase64: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope` +
    ` xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"` +
    ` xmlns:ec="http://ec.gob.sri.ws.recepcion">` +
    `<soapenv:Header></soapenv:Header>` +
    `<soapenv:Body>` +
    `<ec:validarComprobante>` +
    `<xml>${signedXmlBase64}</xml>` +
    `</ec:validarComprobante>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

function buildAuthorizationEnvelope(accessKey: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope` +
    ` xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"` +
    ` xmlns:ec="http://ec.gob.sri.ws.autorizacion">` +
    `<soapenv:Header></soapenv:Header>` +
    `<soapenv:Body>` +
    `<ec:autorizacionComprobante>` +
    `<claveAccesoComprobante>${accessKey}</claveAccesoComprobante>` +
    `</ec:autorizacionComprobante>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

// ── Network helper ─────────────────────────────────────────────────────────

async function soapPost(
  url:     string,
  body:    string,
  timeout: number = 30_000
): Promise<{ ok: boolean; text: string; status: number }> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        "SOAPAction":   `""`,
      },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, text, status: res.status };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Error de red";
    return { ok: false, text: msg, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// ── Reception ──────────────────────────────────────────────────────────────

/**
 * Submits the signed XML to the SRI reception endpoint.
 * The SRI expects the XML as base64Binary — we base64-encode the UTF-8 bytes.
 *
 * @returns RECIBIDA when accepted for processing, DEVUELTA when rejected.
 * DEVUELTA still means the submission was successful (HTTP 200), but the
 * content has structural errors. The errors array describes the problem.
 */
export async function sendToReception(
  signedXml:  string,
  environment: "pruebas" | "produccion"
): Promise<ReceptionResult> {
  const url = environment === "produccion"
    ? SRI_WSDL.PRODUCCION.RECEPTION.replace("?wsdl", "")
    : SRI_WSDL.PRUEBAS.RECEPTION.replace("?wsdl", "");

  // SRI expects the signed XML encoded as base64
  const xmlBase64 = Buffer.from(signedXml, "utf8").toString("base64");
  const envelope  = buildReceptionEnvelope(xmlBase64);

  const { ok, text, status } = await soapPost(url, envelope);

  if (!ok && status === 0) {
    return { ok: false, estado: "ERROR_RED", errors: [{ identificador: "NET", mensaje: text, informacionAdicional: null, tipo: "ERROR" }], raw: text };
  }

  const estado = extractTag(text, "estado")?.toUpperCase();
  const errors = parseSriErrors(text);

  if (estado === "RECIBIDA") {
    return { ok: true, estado: "RECIBIDA", errors, raw: text };
  }

  return { ok: false, estado: "DEVUELTA", errors, raw: text };
}

// ── Authorization ──────────────────────────────────────────────────────────

/**
 * Queries the SRI authorization endpoint for a comprobante by access key.
 * Call after a RECIBIDA reception response.
 *
 * The SRI typically processes within 1-5 seconds. If the status is EN PROCESO,
 * retry after a delay (handled by the pipeline, not this function).
 *
 * @returns AUTORIZADO (with authorization number) or NO AUTORIZADO (with errors).
 */
export async function queryAuthorization(
  accessKey:   string,
  environment: "pruebas" | "produccion"
): Promise<AuthorizationResult> {
  const url = environment === "produccion"
    ? SRI_WSDL.PRODUCCION.AUTHORIZATION.replace("?wsdl", "")
    : SRI_WSDL.PRUEBAS.AUTHORIZATION.replace("?wsdl", "");

  const envelope = buildAuthorizationEnvelope(accessKey);
  const { ok, text, status } = await soapPost(url, envelope);

  if (!ok && status === 0) {
    return { ok: false, estado: "ERROR_RED", numeroAutorizacion: null, fechaAutorizacion: null, errors: [{ identificador: "NET", mensaje: text, informacionAdicional: null, tipo: "ERROR" }], raw: text };
  }

  // Parse authorization response
  const estadoRaw = extractTag(text, "estado")?.toUpperCase();
  const numAuth   = extractTag(text, "numeroAutorizacion");
  const fechaAuth = extractTag(text, "fechaAutorizacion");
  const errors    = parseSriErrors(text);

  if (estadoRaw === "AUTORIZADO" && numAuth) {
    return { ok: true, estado: "AUTORIZADO", numeroAutorizacion: numAuth, fechaAutorizacion: fechaAuth, errors, raw: text };
  }

  if (estadoRaw === "EN PROCESO" || !estadoRaw) {
    return { ok: false, estado: "EN PROCESO", numeroAutorizacion: null, fechaAutorizacion: null, errors, raw: text };
  }

  return { ok: false, estado: "NO AUTORIZADO", numeroAutorizacion: null, fechaAutorizacion: null, errors, raw: text };
}
