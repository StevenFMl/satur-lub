/**
 * TypeScript types for Ecuador SRI electronic invoicing (v2.1.0).
 *
 * These mirror the XML structure of the SRI Ficha Técnica.
 * Use SriInvoice as the canonical internal representation;
 * invoice-xml.ts converts it to the actual XML string.
 */

import type { SriDocType, SriEnvironmentCode, SriIdType, SriPaymentMethod } from "./constants";

// ── Tenant fiscal configuration ────────────────────────────────────────────

export type TenantFiscalConfig = {
  tenant_id:             string;
  // From tenants table
  ruc:                   string;        // 13 digits (e.g. "0930000001001")
  razon_social:          string;        // legal_name from tenants
  nombre_comercial:      string;        // business_name from tenants
  // From tenant_fiscal_config
  dir_matriz:            string;
  dir_estab:             string | null;
  estab:                 string;        // "001"
  pto_emi:               string;        // "001"
  obligado_contabilidad: boolean;
  contribuyente_especial: string | null;
  sri_environment:       "pruebas" | "produccion";
  cert_filename:         string | null;
  cert_expiry:           string | null;  // ISO date
};

// ── Access key generation parameters ──────────────────────────────────────

export type AccessKeyParams = {
  emissionDate:  Date;               // invoice date (will be formatted in EC timezone)
  docType:       SriDocType;
  ruc:           string;             // 13 digits
  environment:   SriEnvironmentCode; // "1" or "2"
  estab:         string;             // "001"
  ptoEmi:        string;             // "001"
  sequential:    number;             // raw integer, padded to 9 digits
  numericCode:   string;             // 8 random digits
  emissionType:  "1";               // always "1" (normal emission)
};

// ── SRI invoice internal representation ───────────────────────────────────

export type SriInfoTributaria = {
  ambiente:       SriEnvironmentCode;
  tipoEmision:    "1";
  razonSocial:    string;
  nombreComercial: string;
  ruc:            string;
  claveAcceso:    string;
  codDoc:         SriDocType;
  estab:          string;
  ptoEmi:         string;
  secuencial:     string;  // zero-padded to 9 chars: "000000001"
  dirMatriz:      string;
};

export type SriTaxDetail = {
  codigo:           string;           // "2" for IVA
  codigoPorcentaje: string;           // "4" for 15% IVA
  descuentoAdicional: string;         // "0.00" usually
  baseImponible:    string;           // 6 decimals
  valor:            string;           // 6 decimals
};

export type SriPaymentDetail = {
  formaPago:    SriPaymentMethod;
  total:        string;               // 2 decimals
  plazo:        string;               // "0" for immediate
  unidadTiempo: string;               // "dias"
};

export type SriInfoFactura = {
  fechaEmision:              string;          // "dd/MM/yyyy"
  dirEstablecimiento:        string;
  contribuyenteEspecial:     string;          // "" if none
  obligadoContabilidad:      "SI" | "NO";
  tipoIdentificacionComprador: SriIdType;
  razonSocialComprador:      string;
  identificacionComprador:   string;
  totalSinImpuestos:         string;          // 2 decimals
  totalDescuento:            string;          // 2 decimals
  totalConImpuestos:         SriTaxDetail[];
  propina:                   string;          // "0.00"
  importeTotal:              string;          // 2 decimals
  moneda:                    "DOLAR";
  pagos:                     SriPaymentDetail[];
};

export type SriItemTax = {
  codigo:           string;
  codigoPorcentaje: string;
  tarifa:           string;           // percentage, e.g. "15.00"
  baseImponible:    string;           // 6 decimals
  valor:            string;           // 6 decimals
};

export type SriDetalle = {
  codigoPrincipal:          string;
  codigoAuxiliar:           string;
  descripcion:              string;
  cantidad:                 string;   // 6 decimals
  precioUnitario:           string;   // net unit price, 6 decimals
  descuento:                string;   // line discount (net), 2 decimals
  precioTotalSinImpuesto:   string;   // net line total, 6 decimals
  impuestos:                SriItemTax[];
};

export type SriCampoAdicional = {
  nombre: string;
  valor:  string;
};

export type SriInvoice = {
  version:        "2.1.0";
  infoTributaria: SriInfoTributaria;
  infoFactura:    SriInfoFactura;
  detalles:       SriDetalle[];
  infoAdicional?: SriCampoAdicional[];
};

// ── Electronic invoice DB record ───────────────────────────────────────────

export type ElectronicInvoiceStatus =
  | "draft"
  | "sent"
  | "authorized"
  | "rejected"
  | "cancelled";

export type ElectronicInvoiceRecord = {
  id:                   string;
  tenant_id:            string;
  sale_id:              string | null;
  sale_return_id:       string | null;
  doc_type:             SriDocType;
  estab:                string;
  pto_emi:              string;
  secuencial:           number;
  doc_number:           string;          // "001-001-000000001" (generated column)
  access_key:           string | null;
  sri_environment:      "pruebas" | "produccion";
  status:               ElectronicInvoiceStatus;
  xml_unsigned:         string | null;
  xml_signed:           string | null;
  authorization_number: string | null;
  authorization_date:   string | null;
  sri_errors:           unknown[] | null;
  cancelled_at:         string | null;
  cancellation_reason:  string | null;
  created_by:           string;
  created_at:           string;
  updated_at:           string;
};

// ── Sale data needed for invoice generation ────────────────────────────────
// Subset of SaleDetailData (from the POS sale detail page).

export type InvoiceSaleItem = {
  id:               string;
  quantity:         number;
  unit_price:       number;   // gross (with IVA)
  discount_amount:  number;   // gross discount
  line_total:       number;   // gross line total (qty × price - discount)
  is_taxable:       boolean;
  tax_rate:         number;
  base_qty:         number;
  product_name:     string;
  product_sku:      string;
};

export type InvoiceSalePayment = {
  payment_method: string;
  amount:         number;
  reference:      string | null;
};

export type InvoiceSaleData = {
  id:             string;
  sale_date:      string;
  created_at:     string;
  total:          number;
  subtotal:       number;   // net total (without IVA)
  tax_total:      number;
  discount_total: number;
  document_kind:  string;
  customer: {
    full_name:       string;
    document_type:   string;
    document_number: string;
    phone:           string | null;
    email:           string | null;
  } | null;
  warehouse: { name: string } | null;
  items:    InvoiceSaleItem[];
  payments: InvoiceSalePayment[];
};
