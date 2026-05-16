/**
 * Ecuador SRI — clave de acceso (access key) generation.
 *
 * Structure (49 digits total):
 *   [8]  fechaEmision  dd MM yyyy
 *   [2]  codDoc        tipo de comprobante ("01" = factura)
 *   [13] ruc           RUC del emisor
 *   [1]  tipoAmbiente  "1"=pruebas, "2"=produccion
 *   [3]  estab         código establecimiento ("001")
 *   [3]  ptoEmi        punto de emisión ("001")
 *   [9]  secuencial    número secuencial ("000000001")
 *   [8]  codNumerico   8 random digits chosen by the issuer
 *   [1]  tipoEmision   always "1" (normal)
 *   [1]  digitoVerif   módulo 11 check digit
 *
 * Reference: Ficha Técnica Comprobantes Electrónicos SRI v2.1.0 §3.1
 */

import { randomInt } from "crypto";
import type { AccessKeyParams } from "./types";

// ── Date helper (Ecuador timezone) ────────────────────────────────────────

function toEcuadorDateParts(date: Date): { dd: string; MM: string; yyyy: string } {
  // "en-CA" gives "YYYY-MM-DD" format with Ecuador timezone applied
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guayaquil",
    year: "numeric",
    month: "2-digit",
    day:   "2-digit",
  }).format(date);
  const [yyyy, MM, dd] = ymd.split("-") as [string, string, string];
  return { dd, MM, yyyy };
}

// ── Módulo 11 verification digit ──────────────────────────────────────────
/**
 * Computes the SRI check digit via módulo 11.
 *
 * Algorithm (from SRI Ficha Técnica, Anexo 1):
 *  1. Starting from the rightmost digit, multiply each digit by the
 *     repeating factor sequence [2, 3, 4, 5, 6, 7, 2, 3, 4, 5, 6, 7, ...]
 *  2. Sum all products.
 *  3. remainder = 11 − (sum % 11)
 *  4. If remainder = 11 → digit = 0
 *     If remainder = 10 → digit = 1
 *     Otherwise → digit = remainder
 */
export function calculateVerificationDigit(key48: string): number {
  if (key48.length !== 48) {
    throw new Error(`SRI access key prefix must be 48 digits; got ${key48.length}.`);
  }

  const factors = [2, 3, 4, 5, 6, 7] as const;
  let sum = 0;

  for (let i = key48.length - 1, f = 0; i >= 0; i--, f++) {
    const digit  = parseInt(key48[i]!, 10);
    const factor = factors[f % 6]!;
    sum += digit * factor;
  }

  const remainder = 11 - (sum % 11);
  if (remainder === 11) return 0;
  if (remainder === 10) return 1;
  return remainder;
}

// ── Random numeric code ───────────────────────────────────────────────────
/**
 * Generates a cryptographically random 8-digit numeric code (with leading zeros).
 * This is the "codNumerico" portion of the clave de acceso — unique per document,
 * chosen by the issuer.
 */
export function generateNumericCode(): string {
  // randomInt(0, 100_000_000) → [0, 99_999_999]
  return String(randomInt(0, 100_000_000)).padStart(8, "0");
}

// ── Main: generate access key ─────────────────────────────────────────────
/**
 * Builds the full 49-digit SRI access key.
 *
 * @example
 * generateAccessKey({
 *   emissionDate: new Date("2026-05-15T14:32:00-05:00"),
 *   docType:      "01",
 *   ruc:          "0930000001001",
 *   environment:  "2",
 *   estab:        "001",
 *   ptoEmi:       "001",
 *   sequential:   1,
 *   numericCode:  "12345678",
 *   emissionType: "1",
 * });
 * // Returns: "150520260109300000010012001001000000001123456781D"
 *            //                                                       ^ check digit
 */
export function generateAccessKey(params: AccessKeyParams): string {
  const { dd, MM, yyyy } = toEcuadorDateParts(params.emissionDate);
  const seq = String(params.sequential).padStart(9, "0");

  if (params.ruc.length !== 13) {
    throw new Error(`RUC must be 13 digits; got "${params.ruc}" (${params.ruc.length}).`);
  }
  if (params.estab.length  !== 3) throw new Error(`estab must be 3 chars; got "${params.estab}".`);
  if (params.ptoEmi.length !== 3) throw new Error(`ptoEmi must be 3 chars; got "${params.ptoEmi}".`);
  if (params.numericCode.length !== 8) throw new Error(`numericCode must be 8 digits; got "${params.numericCode}".`);

  const key48 =
    `${dd}${MM}${yyyy}`      +  //  8: fecha emisión
    params.docType            +  //  2: tipo comprobante
    params.ruc                +  // 13: RUC emisor
    params.environment        +  //  1: ambiente
    params.estab              +  //  3: establecimiento
    params.ptoEmi             +  //  3: punto emisión
    seq                       +  //  9: secuencial
    params.numericCode        +  //  8: código numérico
    params.emissionType;         //  1: tipo emisión
                                 // 48 total

  const digit = calculateVerificationDigit(key48);
  const key49 = key48 + String(digit);

  if (key49.length !== 49) {
    throw new Error(`Generated key has wrong length: ${key49.length} (expected 49).`);
  }

  return key49;
}

// ── Helper: format secuencial for XML ────────────────────────────────────
export function formatSecuencial(sequential: number): string {
  return String(sequential).padStart(9, "0");
}

// ── Helper: format document number for display ───────────────────────────
export function formatDocNumber(estab: string, ptoEmi: string, sequential: number): string {
  return `${estab}-${ptoEmi}-${formatSecuencial(sequential)}`;
}
