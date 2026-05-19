/**
 * RIDE view model — Representación Impresa del Documento Electrónico.
 *
 * Converts raw sale/invoice data (gross prices) into the display-ready
 * strings the SRI RIDE requires (net prices, formatted dates, ID labels).
 *
 * All monetary values in the SRI XML are NET (without IVA).
 * Our DB stores GROSS prices (IVA included).
 * Conversion: net = gross / (1 + taxRate/100)
 */

import Big from "big.js";
import {
  mapBuyerIdType,
  mapPaymentMethod,
  CONSUMIDOR_FINAL_ID,
  CONSUMIDOR_FINAL_NAME,
} from "@/lib/sri/constants";

// ── Input types ────────────────────────────────────────────────────────────

export type RideInputItem = {
  product_name:       string;
  product_sku:        string;
  quantity:           number;
  line_total:         number;   // gross (with IVA)
  is_taxable:         boolean;
  tax_rate:           number;
  presentation_label: string | null;
};

export type RideInput = {
  saleDate:              string;   // ISO date or datetime
  docNumber:             string;   // "001-001-000000001"
  accessKey:             string;   // 49 digits
  authNumber:            string | null;
  authDate:              string | null;
  sri_environment:       "pruebas" | "produccion";
  status:                string;   // "draft" | "authorized" | etc.

  // Issuer (from tenants + tenant_fiscal_config)
  ruc:                   string;
  razonSocial:           string;
  nombreComercial:       string;
  dirMatriz:             string;
  dirEstab:              string | null;
  obligadoContabilidad:  boolean;
  contribuyenteEspecial: string | null;

  // Buyer
  buyerDocType:          string | null;
  buyerName:             string | null;
  buyerDocNumber:        string | null;
  buyerPhone:            string | null;

  // Sale data
  items:         RideInputItem[];
  payments:      { method: string; amount: number }[];
  discountTotal: number;
  importeTotal:  number;
  warehouseName: string | null;
  saleNotes:     string | null;
};

// ── Output types ───────────────────────────────────────────────────────────

export type RideViewItem = {
  seq:                    string;
  codigoPrincipal:        string;
  codigoAuxiliar:         string;
  descripcion:            string;
  cantidad:               string;  // 6 dec
  precioUnitario:         string;  // 6 dec, net
  descuento:              string;  // "0.00"
  precioTotalSinImpuesto: string;  // 6 dec, net
  tarifa:                 string;  // "15.00" | "0.00"
  esGravado:              boolean;
};

export type RidePaymentRow = {
  label:  string;
  codigo: string;
  total:  string;
};

export type RideViewModel = {
  docType:               string;   // "FACTURA"
  docNumber:             string;
  /** Raw status string ("draft" | "authorized" | etc.) — for display in warnings. */
  status:                string;
  accessKey:             string;   // raw 49 digits
  accessKeyFmt:          string;   // grouped with spaces
  authNumber:            string | null;
  authDateFmt:           string | null;
  environment:           "pruebas" | "produccion";
  envLabel:              string;
  isAuthorized:          boolean;
  fechaEmisionFmt:       string;   // "dd/mm/yyyy"
  ruc:                   string;
  razonSocial:           string;
  nombreComercial:       string;
  dirMatriz:             string;
  dirEstab:              string;
  obligadoLabel:         string;   // "SI" | "NO"
  contribuyenteEspecial: string | null;
  buyerIdTypeLabel:      string;
  buyerName:             string;
  buyerDoc:              string;
  buyerPhone:            string | null;
  items:                 RideViewItem[];
  subtotal0:             string;
  subtotal15:            string;
  iva15:                 string;
  totalDescuento:        string;
  propina:               string;
  importeTotal:          string;
  payments:              RidePaymentRow[];
  camposAdicionales:     { nombre: string; valor: string }[];
};

// ── Internal helpers ───────────────────────────────────────────────────────

const TZ = "America/Guayaquil";

function dec2(n: Big): string { return n.round(2, Big.roundHalfUp).toFixed(2); }
function dec6(n: Big): string { return n.round(6, Big.roundHalfUp).toFixed(6); }

function ecDate(iso: string): string {
  const d = iso.length === 10 ? new Date(iso + "T12:00:00Z") : new Date(iso);
  return d.toLocaleDateString("es-EC", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric",
  });
}

function ecDatetime(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    timeZone: TZ,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

const ID_TYPE_LABELS: Record<string, string> = {
  "04": "R.U.C.",
  "05": "CÉDULA DE IDENTIDAD",
  "06": "PASAPORTE",
  "07": "CONSUMIDOR FINAL",
  "08": "IDENTIFICACIÓN DEL EXTERIOR",
  "09": "PLACA",
};

const PAYMENT_SRI_LABELS: Record<string, string> = {
  "01": "Sin utilización del sistema financiero",
  "15": "Compensación de deudas",
  "16": "Tarjeta de débito",
  "17": "Dinero electrónico",
  "18": "Tarjeta prepago",
  "19": "Tarjeta de crédito",
  "20": "Otros con utilización del sistema financiero",
  "21": "Endoso de títulos",
};

// ── Main builder ───────────────────────────────────────────────────────────

export function buildRideViewModel(input: RideInput): RideViewModel {
  // Access key: group into 7-char blocks for readability (49 = 7×7)
  const accessKeyFmt = (input.accessKey ?? "")
    .match(/.{1,7}/g)
    ?.join("  ") ?? (input.accessKey ?? "");

  const fechaEmisionFmt = ecDate(input.saleDate);
  const authDateFmt     = input.authDate ? ecDatetime(input.authDate) : null;

  // ── Buyer ──────────────────────────────────────────────────────────────
  const isConsumidorFinal =
    !input.buyerDocType ||
    input.buyerDocType.toUpperCase() === "CONSUMIDOR_FINAL";

  const sriIdCode       = mapBuyerIdType(input.buyerDocType);
  const buyerIdTypeLabel = ID_TYPE_LABELS[sriIdCode] ?? "IDENTIFICACIÓN";
  const buyerName       = isConsumidorFinal
    ? CONSUMIDOR_FINAL_NAME
    : (input.buyerName?.toUpperCase() ?? CONSUMIDOR_FINAL_NAME);
  const buyerDoc        = isConsumidorFinal
    ? CONSUMIDOR_FINAL_ID
    : (input.buyerDocNumber ?? CONSUMIDOR_FINAL_ID);

  // ── Line items (gross → net) ───────────────────────────────────────────
  const items: RideViewItem[] = input.items.map((item, idx) => {
    const qty    = Big(item.quantity);
    const gross  = Big(item.line_total);
    const isTax  = item.is_taxable && item.tax_rate > 0;
    const factor = isTax
      ? Big(1).plus(Big(item.tax_rate).div(100))
      : Big(1);
    const netLine = gross.div(factor);
    const netUnit = qty.gt(0) ? netLine.div(qty) : Big(0);

    return {
      seq:                    String(idx + 1),
      codigoPrincipal:        item.product_sku || item.product_name.slice(0, 25),
      codigoAuxiliar:         item.presentation_label ?? "",
      descripcion:            item.product_name.toUpperCase(),
      cantidad:               dec6(qty),
      precioUnitario:         dec6(netUnit),
      descuento:              "0.00",
      precioTotalSinImpuesto: dec6(netLine),
      tarifa:                 isTax ? dec2(Big(item.tax_rate)) : "0.00",
      esGravado:              isTax,
    };
  });

  // ── IVA aggregation by rate ────────────────────────────────────────────
  let base0  = Big(0);
  let base15 = Big(0);
  let iva15  = Big(0);

  for (const item of input.items) {
    const gross = Big(item.line_total);
    if (!item.is_taxable || item.tax_rate === 0) {
      base0 = base0.plus(gross);
    } else if (item.tax_rate === 15) {
      const net = gross.div(Big(1.15));
      base15 = base15.plus(net);
      iva15  = iva15.plus(gross.minus(net));
    }
    // Other rates (12%, 14%) ignored for now — add buckets as needed
  }

  // ── Payments ───────────────────────────────────────────────────────────
  const payments: RidePaymentRow[] = input.payments.map((p) => {
    const sriCode = mapPaymentMethod(p.method);
    return {
      label:  PAYMENT_SRI_LABELS[sriCode] ?? p.method,
      codigo: sriCode,
      total:  dec2(Big(p.amount)),
    };
  });
  if (payments.length === 0) {
    payments.push({
      label:  "Sin utilización del sistema financiero",
      codigo: "01",
      total:  "0.00",
    });
  }

  // ── Additional info ────────────────────────────────────────────────────
  const camposAdicionales: { nombre: string; valor: string }[] = [];
  if (input.buyerPhone)    camposAdicionales.push({ nombre: "Teléfono", valor: input.buyerPhone });
  if (input.warehouseName) camposAdicionales.push({ nombre: "Bodega",   valor: input.warehouseName });
  if (input.saleNotes)     camposAdicionales.push({ nombre: "Notas",    valor: input.saleNotes });

  return {
    docType:               "FACTURA",
    docNumber:             input.docNumber,
    status:                input.status,
    accessKey:             input.accessKey,
    accessKeyFmt,
    authNumber:            input.authNumber,
    authDateFmt,
    environment:           input.sri_environment,
    envLabel:              input.sri_environment === "produccion" ? "PRODUCCIÓN" : "PRUEBAS",
    isAuthorized:          input.status === "authorized",
    fechaEmisionFmt,
    ruc:                   input.ruc,
    razonSocial:           input.razonSocial.toUpperCase(),
    nombreComercial:       input.nombreComercial.toUpperCase(),
    dirMatriz:             (input.dirMatriz  || "").toUpperCase(),
    dirEstab:              (input.dirEstab ?? (input.dirMatriz || "")).toUpperCase(),
    obligadoLabel:         input.obligadoContabilidad ? "SI" : "NO",
    contribuyenteEspecial: input.contribuyenteEspecial,
    buyerIdTypeLabel,
    buyerName,
    buyerDoc,
    buyerPhone:            input.buyerPhone,
    items,
    subtotal0:             dec2(base0),
    subtotal15:            dec2(base15),
    iva15:                 dec2(iva15),
    totalDescuento:        dec2(Big(input.discountTotal)),
    propina:               "0.00",
    importeTotal:          dec2(Big(input.importeTotal)),
    payments,
    camposAdicionales,
  };
}
