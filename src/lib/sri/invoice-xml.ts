/**
 * Serializes an SriInvoice to the XML format required by the SRI.
 *
 * Output conforms to schema factura v2.1.0 (XSD validated by the SRI).
 * Characters that are invalid in XML content are escaped automatically.
 *
 * No external XML library is used — template literals are cleaner,
 * more auditable, and avoid dependency risks for a regulated document.
 *
 * Phase 2: signing (XAdES-BES) will wrap this XML with an XML-DSIG
 * structure. The signed XML is what gets submitted to the SRI WSDL.
 */

import type { SriInvoice, SriDetalle, SriTaxDetail, SriCampoAdicional } from "./types";

// ── XML escape ────────────────────────────────────────────────────────────

function esc(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&apos;");
}

// ── Section builders ──────────────────────────────────────────────────────

function buildInfoTributaria(inv: SriInvoice): string {
  const t = inv.infoTributaria;
  return `
  <infoTributaria>
    <ambiente>${esc(t.ambiente)}</ambiente>
    <tipoEmision>${esc(t.tipoEmision)}</tipoEmision>
    <razonSocial>${esc(t.razonSocial)}</razonSocial>
    <nombreComercial>${esc(t.nombreComercial)}</nombreComercial>
    <ruc>${esc(t.ruc)}</ruc>
    <claveAcceso>${esc(t.claveAcceso)}</claveAcceso>
    <codDoc>${esc(t.codDoc)}</codDoc>
    <estab>${esc(t.estab)}</estab>
    <ptoEmi>${esc(t.ptoEmi)}</ptoEmi>
    <secuencial>${esc(t.secuencial)}</secuencial>
    <dirMatriz>${esc(t.dirMatriz)}</dirMatriz>
  </infoTributaria>`.trimStart();
}

function buildTaxDetails(totals: SriTaxDetail[]): string {
  return totals.map((tx) => `
    <totalImpuesto>
      <codigo>${esc(tx.codigo)}</codigo>
      <codigoPorcentaje>${esc(tx.codigoPorcentaje)}</codigoPorcentaje>
      <descuentoAdicional>${esc(tx.descuentoAdicional)}</descuentoAdicional>
      <baseImponible>${esc(tx.baseImponible)}</baseImponible>
      <valor>${esc(tx.valor)}</valor>
    </totalImpuesto>`).join("");
}

function buildInfoFactura(inv: SriInvoice): string {
  const f = inv.infoFactura;
  const pagosXml = f.pagos.map((p) => `
      <pago>
        <formaPago>${esc(p.formaPago)}</formaPago>
        <total>${esc(p.total)}</total>
        <plazo>${esc(p.plazo)}</plazo>
        <unidadTiempo>${esc(p.unidadTiempo)}</unidadTiempo>
      </pago>`).join("");

  return `
  <infoFactura>
    <fechaEmision>${esc(f.fechaEmision)}</fechaEmision>
    <dirEstablecimiento>${esc(f.dirEstablecimiento)}</dirEstablecimiento>
    <contribuyenteEspecial>${esc(f.contribuyenteEspecial)}</contribuyenteEspecial>
    <obligadoContabilidad>${esc(f.obligadoContabilidad)}</obligadoContabilidad>
    <tipoIdentificacionComprador>${esc(f.tipoIdentificacionComprador)}</tipoIdentificacionComprador>
    <razonSocialComprador>${esc(f.razonSocialComprador)}</razonSocialComprador>
    <identificacionComprador>${esc(f.identificacionComprador)}</identificacionComprador>
    <totalSinImpuestos>${esc(f.totalSinImpuestos)}</totalSinImpuestos>
    <totalDescuento>${esc(f.totalDescuento)}</totalDescuento>
    <totalConImpuestos>${buildTaxDetails(f.totalConImpuestos)}
    </totalConImpuestos>
    <propina>${esc(f.propina)}</propina>
    <importeTotal>${esc(f.importeTotal)}</importeTotal>
    <moneda>${esc(f.moneda)}</moneda>
    <pagos>${pagosXml}
    </pagos>
  </infoFactura>`.trimStart();
}

function buildDetalle(d: SriDetalle): string {
  const impuestosXml = d.impuestos.map((imp) => `
        <impuesto>
          <codigo>${esc(imp.codigo)}</codigo>
          <codigoPorcentaje>${esc(imp.codigoPorcentaje)}</codigoPorcentaje>
          <tarifa>${esc(imp.tarifa)}</tarifa>
          <baseImponible>${esc(imp.baseImponible)}</baseImponible>
          <valor>${esc(imp.valor)}</valor>
        </impuesto>`).join("");

  return `
    <detalle>
      <codigoPrincipal>${esc(d.codigoPrincipal)}</codigoPrincipal>
      <codigoAuxiliar>${esc(d.codigoAuxiliar)}</codigoAuxiliar>
      <descripcion>${esc(d.descripcion)}</descripcion>
      <cantidad>${esc(d.cantidad)}</cantidad>
      <precioUnitario>${esc(d.precioUnitario)}</precioUnitario>
      <descuento>${esc(d.descuento)}</descuento>
      <precioTotalSinImpuesto>${esc(d.precioTotalSinImpuesto)}</precioTotalSinImpuesto>
      <impuestos>${impuestosXml}
      </impuestos>
    </detalle>`.trimStart();
}

function buildInfoAdicional(campos: SriCampoAdicional[]): string {
  if (campos.length === 0) return "";
  const fields = campos.map((c) =>
    `    <campoAdicional nombre="${esc(c.nombre)}">${esc(c.valor)}</campoAdicional>`
  ).join("\n");
  return `
  <infoAdicional>
${fields}
  </infoAdicional>`.trimStart();
}

// ── Main serializer ───────────────────────────────────────────────────────

/**
 * Converts an SriInvoice object to the canonical XML string for SRI submission.
 *
 * The output is UTF-8 encoded XML. For signing (Phase 2), wrap this with
 * XAdES-BES structure using xmldsig / node-signpdf or a compatible library.
 */
export function invoiceToXml(invoice: SriInvoice): string {
  const detallesXml = invoice.detalles.map(buildDetalle).join("\n  ");
  const infoAdicionalXml = invoice.infoAdicional
    ? buildInfoAdicional(invoice.infoAdicional)
    : "";

  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<factura id="comprobante" version="${esc(invoice.version)}">`,
    `  ${buildInfoTributaria(invoice)}`,
    `  ${buildInfoFactura(invoice)}`,
    `  <detalles>`,
    `  ${detallesXml}`,
    `  </detalles>`,
    infoAdicionalXml ? `  ${infoAdicionalXml}` : "",
    `</factura>`,
  ].filter(Boolean);

  return parts.join("\n");
}

// ── Validation helpers (Phase 1 sanity checks) ───────────────────────────

export type XmlValidationError = { field: string; message: string };

/**
 * Lightweight validation of the invoice data before XML generation.
 * Full schema validation is performed by the SRI on submission.
 */
export function validateInvoiceData(invoice: SriInvoice): XmlValidationError[] {
  const errors: XmlValidationError[] = [];
  const t = invoice.infoTributaria;
  const f = invoice.infoFactura;

  if (!t.ruc || !/^\d{13}$/.test(t.ruc)) {
    errors.push({ field: "ruc", message: `RUC inválido: "${t.ruc}" (debe tener 13 dígitos).` });
  }
  if (!t.claveAcceso || t.claveAcceso.length !== 49) {
    errors.push({ field: "claveAcceso", message: `Clave de acceso inválida: longitud ${t.claveAcceso?.length ?? 0} (debe ser 49).` });
  }
  if (!t.estab || !/^\d{3}$/.test(t.estab)) {
    errors.push({ field: "estab", message: `Establecimiento inválido: "${t.estab}" (debe ser 3 dígitos).` });
  }
  if (!t.ptoEmi || !/^\d{3}$/.test(t.ptoEmi)) {
    errors.push({ field: "ptoEmi", message: `Punto de emisión inválido: "${t.ptoEmi}".` });
  }
  if (!t.secuencial || !/^\d{9}$/.test(t.secuencial)) {
    errors.push({ field: "secuencial", message: `Secuencial inválido: "${t.secuencial}" (debe ser 9 dígitos).` });
  }
  if (invoice.detalles.length === 0) {
    errors.push({ field: "detalles", message: "La factura debe tener al menos un ítem." });
  }
  if (f.pagos.length === 0) {
    errors.push({ field: "pagos", message: "La factura debe tener al menos una forma de pago." });
  }
  if (parseFloat(f.importeTotal) < 0) {
    errors.push({ field: "importeTotal", message: `Importe total no puede ser negativo: ${f.importeTotal}.` });
  }
  return errors;
}
