/**
 * Maps internal sale data to the SRI invoice structure (SriInvoice).
 *
 * Key conversion notes:
 *
 * 1. PRICES: Our system stores GROSS prices (IVA included).
 *    The SRI XML requires NET prices (without IVA).
 *    Conversion: net = gross / (1 + taxRate/100)
 *    We use Big.js to avoid floating-point rounding errors.
 *
 * 2. DISCOUNTS: Our discount_amount is gross. The SRI "descuento"
 *    field on each line is the NET discount. For the totals,
 *    totalDescuento = sum of net line discounts.
 *
 *    We treat each line's effective price as already incorporating
 *    the discount into the line_total (qty × price - discount = line_total).
 *    So in the XML we show: descuento = 0, precioUnitario = net_line / qty.
 *    This is the simplest and most accurate approach.
 *
 * 3. IVA AGGREGATION: The SRI groups tax amounts by (codigo, codigoPorcentaje).
 *    We aggregate all same-rate taxable items into one totalImpuesto entry.
 *
 * 4. CONSUMIDOR FINAL: When customer.document_type === "CONSUMIDOR_FINAL",
 *    the XML uses identificacion = "9999999999999" (SRI sentinel).
 */

import Big from "big.js";
import {
  SRI_DOC_TYPES,
  SRI_EMISSION_TYPE,
  SRI_TAX_CODES,
  ivaRateCode,
  mapBuyerIdType,
  mapPaymentMethod,
  sriEnvironmentCode,
  CONSUMIDOR_FINAL_ID,
  CONSUMIDOR_FINAL_NAME,
} from "./constants";
import { generateAccessKey, generateNumericCode, formatSecuencial } from "./access-key";
import type {
  SriInvoice,
  SriInfoTributaria,
  SriInfoFactura,
  SriDetalle,
  SriItemTax,
  SriTaxDetail,
  SriPaymentDetail,
  SriCampoAdicional,
  InvoiceSaleData,
  TenantFiscalConfig,
} from "./types";

// ── Formatters ─────────────────────────────────────────────────────────────

function dec2(n: Big): string { return n.round(2, Big.roundHalfUp).toFixed(2); }
function dec6(n: Big): string { return n.round(6, Big.roundHalfUp).toFixed(6); }

function ecDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z"); // noon UTC avoids midnight boundary issues
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    day:   "2-digit",
    month: "2-digit",
    year:  "numeric",
  }).format(d);
  // Returns "dd/MM/yyyy" as required by SRI
}

// ── Main mapper ────────────────────────────────────────────────────────────

export type InvoiceMapperInput = {
  sale:       InvoiceSaleData;
  config:     TenantFiscalConfig;
  sequential: number;
};

/**
 * Produces a fully populated SriInvoice ready for XML serialization.
 * Does NOT perform signing or SRI submission.
 *
 * @returns { invoice: SriInvoice; accessKey: string; numericCode: string }
 */
export function mapSaleToSriInvoice(input: InvoiceMapperInput): {
  invoice:     SriInvoice;
  accessKey:   string;
  numericCode: string;
} {
  const { sale, config, sequential } = input;

  const numericCode = generateNumericCode();
  const envCode     = sriEnvironmentCode(config.sri_environment);

  const accessKey = generateAccessKey({
    emissionDate: new Date(sale.created_at),
    docType:      SRI_DOC_TYPES.FACTURA,
    ruc:          config.ruc,
    environment:  envCode,
    estab:        config.estab,
    ptoEmi:       config.pto_emi,
    sequential,
    numericCode,
    emissionType: SRI_EMISSION_TYPE,
  });

  // ── infoTributaria ──────────────────────────────────────────────────────
  const infoTributaria: SriInfoTributaria = {
    ambiente:        envCode,
    tipoEmision:     SRI_EMISSION_TYPE,
    razonSocial:     config.razon_social.toUpperCase(),
    nombreComercial: config.nombre_comercial.toUpperCase(),
    ruc:             config.ruc,
    claveAcceso:     accessKey,
    codDoc:          SRI_DOC_TYPES.FACTURA,
    estab:           config.estab,
    ptoEmi:          config.pto_emi,
    secuencial:      formatSecuencial(sequential),
    dirMatriz:       config.dir_matriz.toUpperCase(),
  };

  // ── buyer / comprador ───────────────────────────────────────────────────
  const isConsumidorFinal =
    !sale.customer ||
    sale.customer.document_type.toUpperCase() === "CONSUMIDOR_FINAL";

  const buyerIdType = mapBuyerIdType(sale.customer?.document_type);
  const buyerId     = isConsumidorFinal
    ? CONSUMIDOR_FINAL_ID
    : sale.customer!.document_number;
  const buyerName   = isConsumidorFinal
    ? CONSUMIDOR_FINAL_NAME
    : sale.customer!.full_name.toUpperCase();

  // ── Line items (detalles) ───────────────────────────────────────────────
  const detalles: SriDetalle[] = sale.items.map((item) => {
    const qty      = Big(item.quantity);
    const gross    = Big(item.line_total);
    const isFactor = item.is_taxable && item.tax_rate > 0;
    const factor   = isFactor ? Big(1).plus(Big(item.tax_rate).div(100)) : Big(1);

    const netLine   = gross.div(factor);
    const netUnit   = qty.gt(0) ? netLine.div(qty) : Big(0);
    const ivaLine   = gross.minus(netLine);
    const ivaCode   = item.is_taxable ? ivaRateCode(item.tax_rate) : "0";
    const taxCode   = SRI_TAX_CODES.IVA;
    const tarifaPct = item.is_taxable ? dec2(Big(item.tax_rate)) : "0.00";

    const impuesto: SriItemTax = {
      codigo:           taxCode,
      codigoPorcentaje: ivaCode,
      tarifa:           tarifaPct,
      baseImponible:    dec6(netLine),
      valor:            dec6(ivaLine),
    };

    return {
      codigoPrincipal:        item.product_sku || item.id.slice(0, 20),
      codigoAuxiliar:         "",
      descripcion:            item.product_name.toUpperCase(),
      cantidad:               dec6(qty),
      precioUnitario:         dec6(netUnit),
      descuento:              "0.00",
      precioTotalSinImpuesto: dec6(netLine),
      impuestos:              [impuesto],
    };
  });

  // ── Tax aggregation ─────────────────────────────────────────────────────
  // Aggregate by (taxCode, rateCode) — one entry per rate band.
  type TaxKey = string;
  const taxMap = new Map<TaxKey, { baseImponible: Big; valor: Big }>();

  for (const item of sale.items) {
    if (!item.is_taxable || item.tax_rate === 0) continue;
    const gross  = Big(item.line_total);
    const factor = Big(1).plus(Big(item.tax_rate).div(100));
    const net    = gross.div(factor);
    const iva    = gross.minus(net);
    const key: TaxKey = `${SRI_TAX_CODES.IVA}|${ivaRateCode(item.tax_rate)}`;
    const existing = taxMap.get(key);
    if (existing) {
      taxMap.set(key, {
        baseImponible: existing.baseImponible.plus(net),
        valor:         existing.valor.plus(iva),
      });
    } else {
      taxMap.set(key, { baseImponible: net, valor: iva });
    }
  }

  const totalConImpuestos: SriTaxDetail[] = [...taxMap.entries()].map(([key, totals]) => {
    const [code, rateCode] = key.split("|") as [string, string];
    return {
      codigo:             code,
      codigoPorcentaje:   rateCode,
      descuentoAdicional: "0.00",
      baseImponible:      dec2(totals.baseImponible),
      valor:              dec2(totals.valor),
    };
  });

  // 0%-only items: add a IVA-0 entry if any non-taxable item exists
  const hasZeroTax = sale.items.some((i) => !i.is_taxable || i.tax_rate === 0);
  if (hasZeroTax) {
    const zeroBase = sale.items
      .filter((i) => !i.is_taxable || i.tax_rate === 0)
      .reduce((s, i) => s.plus(Big(i.line_total)), Big(0));

    totalConImpuestos.push({
      codigo:             SRI_TAX_CODES.IVA,
      codigoPorcentaje:   "0",
      descuentoAdicional: "0.00",
      baseImponible:      dec2(zeroBase),
      valor:              "0.00",
    });
  }

  // ── Totals ──────────────────────────────────────────────────────────────
  const totalSinImpuestos = dec2(Big(sale.subtotal));
  const totalDescuento    = dec2(Big(sale.discount_total));
  const importeTotal      = dec2(Big(sale.total));

  // ── Payments ────────────────────────────────────────────────────────────
  const pagos: SriPaymentDetail[] = sale.payments.map((p) => ({
    formaPago:    mapPaymentMethod(p.payment_method),
    total:        dec2(Big(p.amount)),
    plazo:        "0",
    unidadTiempo: "dias",
  }));

  // SRI requires at least one payment entry. If none (courtesy sale), add $0 cash.
  if (pagos.length === 0) {
    pagos.push({ formaPago: "01", total: "0.00", plazo: "0", unidadTiempo: "dias" });
  }

  // ── infoFactura ──────────────────────────────────────────────────────────
  const infoFactura: SriInfoFactura = {
    fechaEmision:              ecDate(sale.sale_date),
    dirEstablecimiento:        (config.dir_estab ?? config.dir_matriz).toUpperCase(),
    contribuyenteEspecial:     config.contribuyente_especial ?? "",
    obligadoContabilidad:      config.obligado_contabilidad ? "SI" : "NO",
    tipoIdentificacionComprador: buyerIdType,
    razonSocialComprador:      buyerName,
    identificacionComprador:   buyerId,
    totalSinImpuestos,
    totalDescuento,
    totalConImpuestos,
    propina:                   "0.00",
    importeTotal,
    moneda:                    "DOLAR",
    pagos,
  };

  // ── Additional info (infoAdicional) ─────────────────────────────────────
  const infoAdicional: SriCampoAdicional[] = [];
  if (sale.customer?.phone) {
    infoAdicional.push({ nombre: "Teléfono", valor: sale.customer.phone });
  }
  if (sale.customer?.email) {
    infoAdicional.push({ nombre: "Email",    valor: sale.customer.email });
  }
  if (sale.warehouse?.name) {
    infoAdicional.push({ nombre: "Bodega",   valor: sale.warehouse.name });
  }
  infoAdicional.push({ nombre: "Sistema", valor: "SaturnLub" });

  // ── Compose final invoice ────────────────────────────────────────────────
  const invoice: SriInvoice = {
    version:        "2.1.0",
    infoTributaria,
    infoFactura,
    detalles,
    infoAdicional:  infoAdicional.length > 0 ? infoAdicional : undefined,
  };

  return { invoice, accessKey, numericCode };
}
