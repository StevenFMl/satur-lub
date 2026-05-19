/**
 * Shared formatters for all document exports (CSV, print, PDF).
 *
 * Rules:
 *   DISPLAY → es-EC locale, USD, America/Guayaquil timezone
 *   CSV     → ISO dates ("2024-01-15"), plain decimals ("1200.25"), no locale glyphs
 *             → Excel Spanish recognizes YYYY-MM-DD as date and "1200.25" as number
 */

const TZ = "America/Guayaquil";

// ── Display formatters ─────────────────────────────────────────────────────

const _moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

/** "$1.200,25" — for on-screen use only, never for CSV cells. */
export function formatMoney(amount: number): string {
  return _moneyFmt.format(amount);
}

/** "15/01/2024" — dd/mm/yyyy, Ecuador timezone. */
export function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(iso + "T12:00:00Z") : new Date(iso);
  return d.toLocaleDateString("es-EC", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
  });
}

/** "15/01/2024 14:30" — dd/mm/yyyy hh:mm, Ecuador timezone. */
export function formatDatetime(isoOrZ: string): string {
  if (!isoOrZ) return "—";
  return new Date(isoOrZ).toLocaleString("es-EC", {
    timeZone: TZ,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** "lunes, 15 de enero de 2024" — long form for print headers. */
export function formatDateLong(iso: string): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00Z").toLocaleDateString("es-EC", {
    timeZone: TZ, weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

// ── CSV formatters ─────────────────────────────────────────────────────────

/** "1200.25" — plain decimal, no locale glyphs. Excel parses as a number. */
export function csvMoney(amount: number, decimals = 2): string {
  return amount.toFixed(decimals);
}

/** "2024-01-15" — ISO date. Excel Spanish parses as a date. */
export function csvDate(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 10); // already YYYY-MM-DD
}

/**
 * "2024-01-15 14:30" — ISO datetime (no T, no Z, local-time).
 * Excel recognizes this as a datetime value.
 */
export function csvDatetime(isoOrZ: string): string {
  if (!isoOrZ) return "";
  const d = new Date(isoOrZ);
  // Format in Ecuador time, then strip locale artifacts
  const parts = new Intl.DateTimeFormat("sv-SE", {     // sv-SE → "YYYY-MM-DD HH:mm"
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const { type, value } of parts) map[type] = value;
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;
}

// ── Document file naming ───────────────────────────────────────────────────

function safeSlug(s: string): string {
  return s.replace(/[^a-zA-Z0-9\-_]/g, "_");
}

export type DocFileType =
  | "productos-vendidos"
  | "devoluciones"
  | "iva-ventas"
  | "iva-compras"
  | "resumen-iva"
  | "consolidado-iva"
  | "form104-base"
  | "kardex"
  | "existencias"
  | "rentabilidad-productos"
  | "rentabilidad-ventas"
  | "auditoria-bajo-costo"
  | "documentos-sri";

export function buildDocumentFileName(
  type: DocFileType,
  range: { from?: string; to?: string; single?: string },
  ext = "csv",
): string {
  if (range.single) return `${type}_${safeSlug(range.single)}.${ext}`;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const from  = safeSlug(range.from ?? today);
  const to    = safeSlug(range.to   ?? today);
  return `${type}_${from}_${to}.${ext}`;
}

// ── Legal legends ──────────────────────────────────────────────────────────

export type LegalContext =
  | "ticket"              // 80mm thermal, no SRI
  | "a4_nota"             // A4, venta sin comprobante SRI
  | "a4_factura_pruebas"  // A4 + factura autorizada, ambiente pruebas
  | "a4_factura_prod"     // A4 + factura autorizada, producción
  | "purchase_order"      // orden de compra interna
  | "csv_report";         // encabezado de reporte CSV

export function legalLegend(ctx: LegalContext): {
  primary: string;
  secondary?: string;
} {
  switch (ctx) {
    case "ticket":
      return {
        primary:   "Documento sin validez tributaria ante el SRI.",
        secondary: "Representación comercial interna · no sustituye comprobante.",
      };
    case "a4_nota":
      return {
        primary:   "ESTE DOCUMENTO NO TIENE VALIDEZ TRIBUTARIA ANTE EL SRI",
        secondary: "Representación impresa de uso interno · no es comprobante de venta.",
      };
    case "a4_factura_pruebas":
      return {
        primary:   "⚠  AMBIENTE DE PRUEBAS — COMPROBANTE SIN EFECTO TRIBUTARIO",
        secondary: "Emitido en entorno de pruebas del SRI · no tiene validez fiscal.",
      };
    case "a4_factura_prod":
      return {
        primary:   "Comprobante electrónico autorizado por el Servicio de Rentas Internas.",
      };
    case "purchase_order":
      return {
        primary: "Documento de uso interno · no válido como comprobante de retención.",
      };
    case "csv_report":
      return {
        primary: `Reporte generado por SaturLub · ${formatDatetime(new Date().toISOString())}`,
      };
  }
}

// ── CSV download builder ───────────────────────────────────────────────────

type CsvCell = string | number | null | undefined;

function encodeCsvCell(v: CsvCell): string {
  if (v == null) return "";
  const s = String(v);
  // Quote if: contains comma / quote / newline / starts with Excel formula char
  if (/[,"\n\r]/.test(s) || /^[=+\-@]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build a UTF-8 CSV string with BOM for Excel Spanish compatibility.
 * Headers and rows use comma separator.
 * Line endings are CRLF (Windows/Excel standard).
 */
export function buildCsvContent(
  headers: string[],
  rows:    CsvCell[][],
): string {
  const lines = [
    headers.map(encodeCsvCell).join(","),
    ...rows.map((row) => row.map(encodeCsvCell).join(",")),
  ];
  return "﻿" + lines.join("\r\n"); // BOM + CRLF
}

/**
 * Trigger a browser CSV file download.
 * Use csvMoney() / csvDate() / csvDatetime() for cell values — never
 * pass locale-formatted strings (they break Excel's number/date parsing).
 */
export function downloadCsvFile(
  filename: string,
  headers:  string[],
  rows:     CsvCell[][],
): void {
  const content = buildCsvContent(headers, rows);
  const blob    = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  a.href        = url;
  a.download    = filename;
  a.click();
  URL.revokeObjectURL(url);
}
