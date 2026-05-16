/**
 * Ecuador SRI electronic invoicing — constants.
 *
 * Reflects Ficha Técnica de Comprobantes Electrónicos v2.1.0 (2024).
 * IVA rate updated to 15% (Ley Orgánica Emergencia Fiscal, 2024).
 */

// ── Document type codes ────────────────────────────────────────────────────
export const SRI_DOC_TYPES = {
  FACTURA:                    "01",
  LIQUIDACION_COMPRA:         "03",
  NOTA_CREDITO:               "04",
  NOTA_DEBITO:                "05",
  GUIA_REMISION:              "06",
  COMPROBANTE_RETENCION:      "07",
} as const;

export type SriDocType = (typeof SRI_DOC_TYPES)[keyof typeof SRI_DOC_TYPES];

// ── SRI environment codes ──────────────────────────────────────────────────
export const SRI_ENVIRONMENTS = {
  PRUEBAS:    "1",
  PRODUCCION: "2",
} as const;

export type SriEnvironmentCode = (typeof SRI_ENVIRONMENTS)[keyof typeof SRI_ENVIRONMENTS];

export function sriEnvironmentCode(env: "pruebas" | "produccion"): SriEnvironmentCode {
  return env === "produccion" ? SRI_ENVIRONMENTS.PRODUCCION : SRI_ENVIRONMENTS.PRUEBAS;
}

// ── Emission type ──────────────────────────────────────────────────────────
// 1 = normal emission (the only type currently allowed)
export const SRI_EMISSION_TYPE = "1" as const;

// ── Buyer identification type codes ───────────────────────────────────────
export const SRI_ID_TYPES = {
  RUC:                  "04",
  CEDULA:               "05",
  PASAPORTE:            "06",
  CONSUMIDOR_FINAL:     "07",
  ID_EXTERIOR:          "08",
  PLACA:                "09",
} as const;

export type SriIdType = (typeof SRI_ID_TYPES)[keyof typeof SRI_ID_TYPES];

/**
 * Maps our internal document_type strings to SRI buyer ID type codes.
 * "CONSUMIDOR_FINAL" is a special sentinel used when no specific buyer is identified.
 */
export function mapBuyerIdType(documentType: string | null | undefined): SriIdType {
  if (!documentType) return SRI_ID_TYPES.CONSUMIDOR_FINAL;
  const upper = documentType.toUpperCase();
  if (upper === "RUC"             || upper === "04") return SRI_ID_TYPES.RUC;
  if (upper === "CEDULA"          || upper === "CI" || upper === "05") return SRI_ID_TYPES.CEDULA;
  if (upper === "PASAPORTE"       || upper === "06") return SRI_ID_TYPES.PASAPORTE;
  if (upper === "CONSUMIDOR_FINAL"|| upper === "07") return SRI_ID_TYPES.CONSUMIDOR_FINAL;
  if (upper === "ID_EXTERIOR"     || upper === "08") return SRI_ID_TYPES.ID_EXTERIOR;
  return SRI_ID_TYPES.CONSUMIDOR_FINAL;
}

/** SRI RUC/ID used for Consumidor Final */
export const CONSUMIDOR_FINAL_ID = "9999999999999";
export const CONSUMIDOR_FINAL_NAME = "CONSUMIDOR FINAL";

// ── Payment method codes ───────────────────────────────────────────────────
// SRI Tabla 24 — Forma de Pago
export const SRI_PAYMENT_METHODS = {
  EFECTIVO:              "01",  // Sin utilización del sistema financiero
  COMP_DEUDAS:          "15",
  TARJETA_DEBITO:       "16",
  DINERO_ELECTRONICO:   "17",
  TARJETA_PREPAGO:      "18",
  TARJETA_CREDITO:      "19",
  OTROS_FINANCIERO:     "20",  // Transferencia, depósito
  ENDOSO_TITULOS:       "21",
} as const;

export type SriPaymentMethod = (typeof SRI_PAYMENT_METHODS)[keyof typeof SRI_PAYMENT_METHODS];

/**
 * Maps our internal payment_method strings to SRI codes.
 */
export function mapPaymentMethod(method: string): SriPaymentMethod {
  const m = method.toLowerCase();
  if (m === "cash"     || m === "efectivo")      return SRI_PAYMENT_METHODS.EFECTIVO;
  if (m === "card"     || m === "tarjeta")       return SRI_PAYMENT_METHODS.TARJETA_CREDITO;
  if (m === "transfer" || m === "transferencia") return SRI_PAYMENT_METHODS.OTROS_FINANCIERO;
  // Default: cash
  return SRI_PAYMENT_METHODS.EFECTIVO;
}

// ── Tax codes ──────────────────────────────────────────────────────────────
// SRI Tabla 17 — Impuesto
export const SRI_TAX_CODES = {
  IVA:                  "2",
  ICE:                  "3",
  IRBPNR:               "5",
} as const;

// SRI Tabla 18 — Código Porcentaje IVA
// As of 2024: 15% IVA is código 4
export const SRI_IVA_RATE_CODES: Record<number, string> = {
  0:   "0",   // tarifa 0%
  12:  "2",   // 12% (historical, pre-2024)
  14:  "3",   // 14% (historical)
  15:  "4",   // 15% (current, 2024)
} as const;

/** Maps our internal tax_rate (number) to SRI codigoPorcentaje */
export function ivaRateCode(taxRate: number): string {
  return SRI_IVA_RATE_CODES[taxRate] ?? "4"; // default 15%
}

// ── SRI WSDL endpoints ─────────────────────────────────────────────────────
// Used in Phase 2 (signing + sending). Not needed for Phase 1.
export const SRI_WSDL = {
  PRUEBAS: {
    RECEPTION:     "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl",
    AUTHORIZATION: "https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
  },
  PRODUCCION: {
    RECEPTION:     "https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl",
    AUTHORIZATION: "https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl",
  },
} as const;
