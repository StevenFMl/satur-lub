/**
 * Server-side HTML template for the RIDE (Representación Impresa del
 * Documento Electrónico).
 *
 * DESIGN: renderRideHtml() consumes the same RideViewModel used by the
 * browser React component (RideReceipt). No fiscal logic lives here —
 * all number formatting, IVA calculations, and buyer-type mapping are
 * done upstream in buildRideViewModel().
 *
 * Output: a standalone <!DOCTYPE html> document that Puppeteer renders
 * to PDF. All styles are embedded; no external resources are loaded.
 */

import type { RideViewModel } from "./ride-view-model";

// ── Utility ────────────────────────────────────────────────────────────────

/** HTML-escape a string to prevent injection in template literals. */
function e(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build the professional PDF filename for a RIDE. */
export function buildRidePdfFilename(vm: Pick<RideViewModel, "docNumber" | "environment">): string {
  const envSuffix = vm.environment === "pruebas" ? "_pruebas" : "";
  return `factura${envSuffix}_${vm.docNumber}.pdf`;
}

// ── Embedded CSS ───────────────────────────────────────────────────────────

const RIDE_CSS = `
  @page { size: A4 portrait; margin: 10mm 12mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.5pt;
    line-height: 1.3;
    color: #1a1a1a;
    margin: 0;
    padding: 0;
  }
  table { width: 100%; border-collapse: collapse; }
  .mono { font-family: "Courier New", Courier, monospace; }
  .bold { font-weight: bold; }
  .upper { text-transform: uppercase; }
  .muted { color: #888; }

  /* Environment warning */
  .env-warn {
    background: #fef3c7;
    border: 2px solid #f59e0b;
    padding: 5px 10px;
    margin-bottom: 6px;
    font-weight: bold;
    font-size: 8pt;
    color: #92400e;
    text-align: center;
  }

  /* Header table */
  .header-tbl { border: 1px solid #999; margin-bottom: 6px; }
  .issuer-cell {
    width: 55%;
    padding: 8px 10px;
    vertical-align: top;
    border-right: 1px solid #999;
  }
  .doc-cell {
    width: 45%;
    padding: 8px 10px;
    vertical-align: top;
    background: #fafafa;
  }
  .issuer-name {
    font-weight: bold;
    font-size: 12pt;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 4px;
  }
  .label-row { display: table; width: 100%; margin-bottom: 1px; }
  .label-col { display: table-cell; color: #666; width: 110px; padding-right: 4px; vertical-align: top; }
  .label-val { display: table-cell; vertical-align: top; word-break: break-word; }

  /* Document identification */
  .ruc-center { text-align: center; margin-bottom: 6px; }
  .ruc-label { font-size: 8pt; color: #666; margin-bottom: 1px; }
  .ruc-value { font-weight: bold; font-size: 11pt; letter-spacing: 0.05em; }
  .doc-type-block {
    text-align: center;
    border-top: 1px solid #ccc;
    padding-top: 5px;
    margin-bottom: 5px;
  }
  .doc-type-label { font-weight: bold; font-size: 11pt; text-transform: uppercase; }
  .doc-number { font-weight: bold; font-size: 9.5pt; font-family: "Courier New", Courier, monospace; margin-top: 2px; }
  .auth-block { border-top: 1px solid #ccc; padding-top: 4px; margin-top: 4px; font-size: 7pt; }
  .auth-sublabel { color: #666; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em; margin-bottom: 1px; }
  .auth-number { font-family: "Courier New", Courier, monospace; font-size: 7pt; word-break: break-all; }
  .access-key-block { border-top: 1px solid #ccc; padding-top: 4px; margin-top: 4px; }
  .access-key-label { color: #666; font-size: 6.5pt; text-transform: uppercase; font-weight: bold; letter-spacing: 0.05em; margin-bottom: 2px; }
  .access-key-text {
    font-family: "Courier New", Courier, monospace;
    font-size: 6.5pt;
    word-break: break-all;
    letter-spacing: 0.06em;
    background: #f5f5f5;
    padding: 3px 4px;
    border: 1px solid #ddd;
    line-height: 1.6;
  }
  .qr-container { text-align: center; margin-top: 5px; }
  .qr-container svg { width: 62px; height: 62px; }

  /* Buyer table */
  .buyer-tbl { border: 1px solid #ccc; margin-bottom: 6px; }
  .buyer-cell { padding: 4px 8px; vertical-align: top; border-right: 1px solid #ccc; }
  .buyer-cell-last { padding: 4px 8px; vertical-align: top; }
  .cell-label { color: #666; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.05em; display: block; }
  .cell-value { font-weight: bold; margin-top: 1px; }

  /* Items table */
  .items-tbl { margin-bottom: 8px; font-size: 7.5pt; }
  .th {
    background: #1a1a1a;
    color: white;
    font-weight: bold;
    text-transform: uppercase;
    font-size: 7pt;
    letter-spacing: 0.04em;
    padding: 3px 5px;
    border: 1px solid #333;
  }
  .td { padding: 3px 5px; border: 1px solid #ccc; vertical-align: top; word-break: break-word; overflow-wrap: break-word; }
  .td-right { padding: 3px 5px; border: 1px solid #ccc; text-align: right; vertical-align: top; white-space: nowrap; }
  .td-center { padding: 3px 5px; border: 1px solid #ccc; text-align: center; vertical-align: top; }
  .tr-odd  { background: white; page-break-inside: avoid; }
  .tr-even { background: #f8f8f8; page-break-inside: avoid; }

  /* Payments + Totals layout — table-based for print reliability */
  .bottom-row { display: table; width: 100%; margin-bottom: 8px; border-spacing: 10px 0; }
  .payments-col { display: table-cell; vertical-align: top; }
  .totals-col { display: table-cell; width: 200px; vertical-align: top; border: 1px solid #ccc; }
  .total-row {
    display: flex;
    justify-content: space-between;
    padding: 3px 8px;
    border-bottom: 1px solid #eee;
    font-size: 7.5pt;
  }
  .total-row.final {
    background: #1a1a1a;
    color: white;
    font-weight: bold;
    font-size: 9pt;
  }

  /* Additional info */
  .additional-tbl { width: 60%; margin-bottom: 8px; font-size: 7.5pt; }

  /* Footer */
  .footer {
    border-top: 1px solid #ccc;
    padding-top: 6px;
    font-size: 7pt;
    color: #888;
    text-align: center;
  }
  .footer .legal { font-weight: bold; color: #1a1a1a; margin-bottom: 2px; }
  .footer .legal-warn { font-weight: bold; color: #b45309; margin-bottom: 2px; }
`;

// ── Main renderer ──────────────────────────────────────────────────────────

/**
 * Renders a standalone HTML document representing the RIDE for the given
 * view model.  Pass qrSvg (SVG string from buildAccessKeyQrSvg) to embed
 * the QR code in the document box.
 */
export function renderRideHtml(vm: RideViewModel, qrSvg?: string | null): string {

  // ── Environment / status warning ─────────────────────────────────────────
  const envWarnHtml = !vm.isAuthorized
    ? `<div class="env-warn">${e(
        vm.environment === "pruebas"
          ? "⚠  AMBIENTE DE PRUEBAS — COMPROBANTE SIN EFECTO TRIBUTARIO"
          : `Estado: ${vm.status ?? "PENDIENTE"} — Comprobante no autorizado`
      )}</div>`
    : "";

  // ── Authorization block (right column, header) ───────────────────────────
  const authBlockHtml = vm.isAuthorized && vm.authNumber
    ? `<div class="auth-block">
        <div class="auth-sublabel">Número de Autorización</div>
        <div class="auth-number mono">${e(vm.authNumber)}</div>
        ${vm.authDateFmt
          ? `<div style="margin-top:2px;"><span style="color:#666;">Fecha y Hora Autorización: </span>${e(vm.authDateFmt)}</div>`
          : ""}
      </div>`
    : "";

  // ── Access key + QR (right column, header) ───────────────────────────────
  const qrHtml = qrSvg
    ? `<div class="qr-container">${qrSvg}</div>`
    : "";

  const accessKeyHtml = `
    <div class="access-key-block">
      <div class="access-key-label">Clave de Acceso</div>
      <div class="access-key-text mono">${e(vm.accessKeyFmt)}</div>
      ${qrHtml}
    </div>`;

  // ── Issuer's establishment address ────────────────────────────────────────
  const dirEstabRow = vm.dirEstab && vm.dirEstab !== vm.dirMatriz
    ? `<div class="label-row"><span class="label-col">Dir. Establecimiento:</span><span class="label-val">${e(vm.dirEstab)}</span></div>`
    : "";

  const contribuyenteRow = vm.contribuyenteEspecial
    ? `<div class="label-row"><span class="label-col">Contribuyente Especial:</span><span class="label-val">${e(vm.contribuyenteEspecial)}</span></div>`
    : "";

  // ── Items rows ────────────────────────────────────────────────────────────
  const itemRowsHtml = vm.items.map((item, idx) => `
    <tr class="${idx % 2 === 0 ? "tr-odd" : "tr-even"}">
      <td class="td-center muted">${e(item.seq)}</td>
      <td class="td mono" style="font-size:7pt;">${e(item.codigoPrincipal)}</td>
      <td class="td" style="font-size:7pt;">${e(item.codigoAuxiliar) || "—"}</td>
      <td class="td bold">${e(item.descripcion)}</td>
      <td class="td-right mono">${e(item.cantidad)}</td>
      <td class="td-right mono">${e(item.precioUnitario)}</td>
      <td class="td-right mono muted">${e(item.descuento)}</td>
      <td class="td-right mono bold">${e(item.precioTotalSinImpuesto)}</td>
    </tr>`).join("");

  // ── Payment rows ─────────────────────────────────────────────────────────
  const paymentRowsHtml = vm.payments.map((p) => `
    <tr>
      <td class="td">${e(p.label)}</td>
      <td class="td-right mono">${e(p.total)}</td>
    </tr>`).join("");

  // ── Additional info rows ──────────────────────────────────────────────────
  const additionalRowsHtml = vm.camposAdicionales.map((c) => `
    <tr>
      <td class="td muted">${e(c.nombre)}</td>
      <td class="td">${e(c.valor)}</td>
    </tr>`).join("");

  const additionalSectionHtml = vm.camposAdicionales.length > 0
    ? `<table class="additional-tbl items-tbl">
        <thead>
          <tr>
            <th class="th" style="text-align:left;">Información Adicional</th>
            <th class="th" style="text-align:left;">Detalle</th>
          </tr>
        </thead>
        <tbody>${additionalRowsHtml}</tbody>
      </table>`
    : "";

  // ── Footer legal legend ───────────────────────────────────────────────────
  const footerLegalHtml = vm.isAuthorized && vm.environment === "produccion"
    ? `<div class="legal">Comprobante electrónico autorizado por el Servicio de Rentas Internas del Ecuador.</div>`
    : `<div class="legal-warn">${e(
        vm.environment === "pruebas"
          ? "⚠ AMBIENTE DE PRUEBAS — Este comprobante no tiene efecto tributario."
          : "Comprobante pendiente de autorización."
      )}</div>`;

  // ── Second buyer row ──────────────────────────────────────────────────────
  const buyerPhoneCell = vm.buyerPhone
    ? `<td class="buyer-cell" style="width:25%;">
        <span class="cell-label">Teléfono</span>
        <div class="cell-value">${e(vm.buyerPhone)}</div>
      </td>`
    : `<td class="buyer-cell" style="width:25%;"></td>`;

  // ── Assemble full document ────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RIDE ${e(vm.docType)} ${e(vm.docNumber)}</title>
  <style>${RIDE_CSS}</style>
</head>
<body>

${envWarnHtml}

<!-- ── Header ─────────────────────────────────────────────────────── -->
<table class="header-tbl">
  <tbody>
    <tr>
      <!-- Left: Issuer info -->
      <td class="issuer-cell">
        <div class="issuer-name">${e(vm.razonSocial)}</div>
        ${vm.nombreComercial !== vm.razonSocial
          ? `<div style="font-size:9pt;color:#555;margin-bottom:4px;">Nombre Comercial: ${e(vm.nombreComercial)}</div>`
          : ""}
        <div style="font-size:7.5pt;margin-top:2px;">
          <div class="label-row"><span class="label-col">Dir. Matriz:</span><span class="label-val">${e(vm.dirMatriz) || "—"}</span></div>
          ${dirEstabRow}
          ${contribuyenteRow}
          <div class="label-row"><span class="label-col">Obligado Contabilidad:</span><span class="label-val">${e(vm.obligadoLabel)}</span></div>
          <div class="label-row"><span class="label-col">Ambiente:</span><span class="label-val" style="font-weight:bold;">${e(vm.envLabel)}</span></div>
          <div class="label-row"><span class="label-col">Tipo Emisión:</span><span class="label-val">EMISIÓN NORMAL</span></div>
        </div>
      </td>
      <!-- Right: Document identification -->
      <td class="doc-cell">
        <div class="ruc-center">
          <div class="ruc-label">R.U.C.</div>
          <div class="ruc-value mono">${e(vm.ruc)}</div>
        </div>
        <div class="doc-type-block">
          <div class="doc-type-label">${e(vm.docType)}</div>
          <div class="doc-number">${e(vm.docNumber)}</div>
        </div>
        ${authBlockHtml}
        ${accessKeyHtml}
      </td>
    </tr>
  </tbody>
</table>

<!-- ── Buyer info ─────────────────────────────────────────────────── -->
<table class="buyer-tbl">
  <tbody>
    <tr>
      <td class="buyer-cell" style="width:50%;">
        <span class="cell-label">Razón Social / Nombres y Apellidos</span>
        <div class="cell-value">${e(vm.buyerName)}</div>
      </td>
      <td class="buyer-cell" style="width:30%;">
        <span class="cell-label">Identificación</span>
        <div class="cell-value mono">${e(vm.buyerDoc)}</div>
      </td>
      <td class="buyer-cell-last" style="width:20%;">
        <span class="cell-label">Fecha Emisión</span>
        <div class="cell-value">${e(vm.fechaEmisionFmt)}</div>
      </td>
    </tr>
    <tr style="border-top:1px solid #eee;">
      <td class="buyer-cell">
        <span class="cell-label">Tipo Identificación</span>
        <div style="margin-top:1px;">${e(vm.buyerIdTypeLabel)}</div>
      </td>
      ${buyerPhoneCell}
      <td class="buyer-cell-last">
        <span class="cell-label">Guía Remisión</span>
        <div style="margin-top:1px;color:#aaa;">—</div>
      </td>
    </tr>
  </tbody>
</table>

<!-- ── Line items ─────────────────────────────────────────────────── -->
<table class="items-tbl">
  <thead>
    <tr>
      <th class="th" style="width:20px;text-align:center;">N°</th>
      <th class="th" style="width:80px;text-align:left;">Cód. Principal</th>
      <th class="th" style="width:60px;text-align:left;">Cód. Auxiliar</th>
      <th class="th" style="text-align:left;">Descripción</th>
      <th class="th" style="width:55px;text-align:right;">Cantidad</th>
      <th class="th" style="width:70px;text-align:right;">Precio Unitario</th>
      <th class="th" style="width:55px;text-align:right;">Descuento</th>
      <th class="th" style="width:72px;text-align:right;">P. Total S/IVA</th>
    </tr>
  </thead>
  <tbody>
    ${itemRowsHtml}
  </tbody>
</table>

<!-- ── Payments + Totals ─────────────────────────────────────────── -->
<div class="bottom-row">
  <!-- Payments -->
  <div class="payments-col">
    <table class="items-tbl">
      <thead>
        <tr>
          <th class="th" style="text-align:left;">Forma de Pago</th>
          <th class="th" style="width:70px;text-align:right;">Valor</th>
        </tr>
      </thead>
      <tbody>${paymentRowsHtml}</tbody>
    </table>
  </div>
  <!-- Totals -->
  <div class="totals-col">
    <div class="total-row"><span>Subtotal IVA 0%</span><span class="mono">${e(vm.subtotal0)}</span></div>
    <div class="total-row muted"><span>Subtotal No Objeto de IVA</span><span class="mono">0.00</span></div>
    <div class="total-row muted"><span>Subtotal Exento de IVA</span><span class="mono">0.00</span></div>
    <div class="total-row"><span>Subtotal 15%</span><span class="mono">${e(vm.subtotal15)}</span></div>
    <div class="total-row ${parseFloat(vm.totalDescuento) > 0 ? "" : "muted"}"><span>Descuento</span><span class="mono">${e(vm.totalDescuento)}</span></div>
    <div class="total-row muted"><span>ICE</span><span class="mono">0.00</span></div>
    <div class="total-row muted"><span>IRBPNR</span><span class="mono">0.00</span></div>
    <div class="total-row"><span>IVA 15%</span><span class="mono">${e(vm.iva15)}</span></div>
    <div class="total-row muted"><span>Propina</span><span class="mono">${e(vm.propina)}</span></div>
    <div class="total-row final"><span>VALOR TOTAL</span><span class="mono">${e(vm.importeTotal)}</span></div>
  </div>
</div>

<!-- ── Additional info ─────────────────────────────────────────────── -->
${additionalSectionHtml}

<!-- ── Footer ─────────────────────────────────────────────────────── -->
<div class="footer">
  ${footerLegalHtml}
  <div style="margin-top:2px;">${e(vm.razonSocial)} · RUC ${e(vm.ruc)}${vm.dirMatriz ? ` · ${e(vm.dirMatriz)}` : ""}</div>
  <div style="margin-top:2px;font-size:6.5pt;">Impreso: ${new Date().toLocaleString("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</div>
</div>

</body>
</html>`;
}
