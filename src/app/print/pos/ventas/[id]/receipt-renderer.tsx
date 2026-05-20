"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buildRideViewModel, type RideInput } from "@/lib/documents/ride-view-model";

// ── Types ──────────────────────────────────────────────────────────────────

export type FiscalConfigData = {
  razon_social:           string;
  dir_matriz:             string;
  dir_estab:              string | null;
  obligado_contabilidad:  boolean;
  contribuyente_especial: string | null;
};

export type ReceiptItem = {
  id:                  string;
  product_name:        string;
  product_sku:         string;
  quantity:            number;
  unit_price:          number;
  original_unit_price: number | null;   // list price before manual override; null = no override
  line_total:          number;
  discount_amount:     number;          // explicit flat discount applied on top of price
  is_taxable:          boolean;
  tax_rate:            number;
  base_qty:            number;
  presentation_label:  string | null;
  price_override_type: string | null;
};

export type ReceiptReturn = {
  id:                       string;
  return_type:              string;
  reason:                   string;
  refund_amount:            number;
  refund_method:            string | null;
  processed_at:             string;
  exchange_sale_id:         string | null;
  exchange_credit_applied:   number;
  exchange_credit_refunded:  number;
};

export type ReceiptData = {
  id:                  string;
  sale_date:           string;
  created_at:          string;
  document_kind:       string;
  status:              string;
  total:               number;
  subtotal:            number;
  tax_total:           number;
  discount_total:      number;
  notes:               string | null;
  cancelled_at:        string | null;
  cancellation_reason: string | null;
  customer: {
    full_name:       string;
    document_type:   string;
    document_number: string;
    phone:           string | null;
  } | null;
  warehouse: { name: string } | null;
  items:    ReceiptItem[];
  payments: { payment_method: string; amount: number; reference: string | null }[];
  returns:  ReceiptReturn[];
  tenant: {
    name:    string;
    ruc:     string | null;
    address: string | null;
    phone:   string | null;
    email:   string | null;
  };
  /**
   * Present when the sale has an electronic invoice (factura SRI).
   * null = venta sin comprobante electrónico → generic "no SRI" legend.
   */
  invoice?: {
    doc_number:           string | null;
    access_key:           string | null;
    authorization_number: string | null;
    authorization_date:   string | null;
    sri_environment:      string;   // "pruebas" | "produccion"
    status:               string;   // "authorized" | "rejected" | etc.
  } | null;
  /** SRI fiscal config. Present when tenant has completed fiscal setup. */
  fiscalConfig?: FiscalConfigData | null;
};

// ── Formatters ─────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia",
};

const REFUND_LABELS: Record<string, string> = {
  cash: "Efectivo", transfer: "Transferencia", store_credit: "Nota a favor",
};

// ── Discount helpers ───────────────────────────────────────────────────────

/**
 * Discount to display for a line item (ticket "Descuento" line, A4 "Desc." column,
 * totals "Ahorros / Desc." row).
 *
 * Only real discounts count: when the final charged price (unit_price) is
 * LOWER than the original list price (original_unit_price). Markups (override
 * toward a higher price) are internal adjustments and must never appear as a
 * discount on a customer-facing document.
 */
function lineDiscount(item: ReceiptItem): number {
  const impliedPerLine =
    item.original_unit_price != null && item.original_unit_price > item.unit_price
      ? (item.original_unit_price - item.unit_price) * item.quantity
      : 0;
  return Math.round((impliedPerLine + item.discount_amount) * 100) / 100;
}

/**
 * Price to display in the A4 "P. Unit." column.
 *
 * Accounting rule: when there IS a real discount (list > final), the column
 * shows the list price and the discount column carries the reduction so the
 * math holds: list × qty − disc = line_total.
 *
 * When there is NO discount (no override, or markup), the column shows the
 * final charged price so the math also holds: final × qty = line_total.
 *
 * Never shows the original price for markups — that would make the A4 show
 * a lower "P. Unit." than the actual line total, confusing the customer.
 */
function displayUnitPrice(item: ReceiptItem): number {
  return (item.original_unit_price != null && item.original_unit_price > item.unit_price)
    ? item.original_unit_price
    : item.unit_price;
}

function fmtDatetime(iso: string): string {
  return new Date(iso).toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("es-EC", {
    timeZone: "America/Guayaquil",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

// ── Main component ─────────────────────────────────────────────────────────

export function ReceiptRenderer({
  data,
  format: initialFormat,
  saleId,
}: {
  data:          ReceiptData;
  format:        "ticket" | "a4" | "ride";
  saleId:        string;
}) {
  const router     = useRouter();
  const [fmt, setFmt] = React.useState<"ticket" | "a4" | "ride">(initialFormat);

  // Auto-print on mount with a small delay for fonts to load
  React.useEffect(() => {
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, []);

  const switchFormat = (next: "ticket" | "a4" | "ride") => {
    setFmt(next);
    router.replace(`?format=${next}`, { scroll: false });
  };

  // RIDE button shown when the invoice has a doc_number (any status)
  const hasRide =
    !!data.invoice?.doc_number &&
    !!data.invoice?.access_key;

  const ticketCss = `
    @page { size: 80mm auto; margin: 2mm 3mm; }
    @media print {
      body  { background: white !important; }
      .no-print { display: none !important; }
      .ticket-receipt { width: 76mm; font-size: 8.5pt; }
      .a4-receipt     { display: none !important; }
    }
    /* Long product names: break inside the narrow ticket width */
    .ticket-receipt .item-name {
      word-break: break-word;
      overflow-wrap: break-word;
      white-space: normal;
    }
  `;

  const a4Css = `
    @page { size: A4 portrait; margin: 15mm 18mm; }
    @media print {
      body  { background: white !important; }
      .no-print { display: none !important; }
      .ticket-receipt { display: none !important; }
      .ride-receipt   { display: none !important; }
      .a4-receipt     { width: 100%; font-size: 10pt; }
      /* Keep each item row together; allow page breaks between rows */
      .a4-receipt tbody tr { page-break-inside: avoid; }
      /* SRI info box and totals block stay together */
      .sri-box, .totals-block { page-break-inside: avoid; }
      /* Footer always at the bottom of the last page */
      .a4-footer { margin-top: auto; }
    }
  `;

  const rideCss = `
    @page { size: A4 portrait; margin: 10mm 12mm; }
    @media print {
      body  { background: white !important; }
      .no-print       { display: none !important; }
      .ticket-receipt { display: none !important; }
      .a4-receipt     { display: none !important; }
      .ride-receipt   { width: 100%; font-size: 8.5pt; }
      .ride-receipt tbody tr { page-break-inside: avoid; }
      .ride-totals-block     { page-break-inside: avoid; }
    }
  `;

  return (
    <>
      <style>{fmt === "ticket" ? ticketCss : fmt === "ride" ? rideCss : a4Css}</style>

      {/* ── Screen controls (hidden on print) ───────────────── */}
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-neutral-300 bg-neutral-100 px-4 py-2.5 print:hidden">
        <Link
          href={`/dashboard/pos/ventas/${saleId}`}
          className="flex items-center gap-1.5 rounded border border-neutral-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900"
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
          Volver a venta
        </Link>

        <div className="flex rounded border border-neutral-300 overflow-hidden">
          <button
            type="button"
            onClick={() => switchFormat("ticket")}
            className={[
              "px-3 py-1.5 text-[11px] font-semibold transition-colors",
              fmt === "ticket"
                ? "bg-neutral-800 text-white"
                : "bg-white text-neutral-600 hover:bg-neutral-50",
            ].join(" ")}
          >
            Ticket 80mm
          </button>
          <button
            type="button"
            onClick={() => switchFormat("a4")}
            className={[
              "border-l border-neutral-300 px-3 py-1.5 text-[11px] font-semibold transition-colors",
              fmt === "a4"
                ? "bg-neutral-800 text-white"
                : "bg-white text-neutral-600 hover:bg-neutral-50",
            ].join(" ")}
          >
            A4 formal
          </button>
          {hasRide && (
            <button
              type="button"
              onClick={() => switchFormat("ride")}
              className={[
                "border-l border-neutral-300 px-3 py-1.5 text-[11px] font-semibold transition-colors",
                fmt === "ride"
                  ? "bg-emerald-700 text-white"
                  : "bg-white text-emerald-700 hover:bg-emerald-50",
              ].join(" ")}
            >
              RIDE / Factura SRI
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded border border-blue-600 bg-blue-600 px-4 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-blue-700"
        >
          <PrinterIcon className="h-3.5 w-3.5" />
          Imprimir
        </button>

        <span className="text-[10px] text-neutral-400">
          {data.status === "cancelled"
            ? "⚠ Venta anulada"
            : `Venta #${shortId(data.id)}`}
        </span>
      </div>

      {/* ── Receipt preview container ────────────────────────── */}
      <div className={[
        "mx-auto py-6 px-4 print:p-0 print:m-0",
        fmt === "ticket" ? "max-w-[100mm]" : "max-w-[210mm]",
      ].join(" ")}>
        {fmt === "ticket"
          ? <TicketReceipt data={data} />
          : fmt === "ride"
            ? <RideReceipt data={data} />
            : <A4Receipt   data={data} />}
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TICKET RECEIPT (80mm thermal)
// ══════════════════════════════════════════════════════════════════════════════

function TicketReceipt({ data }: { data: ReceiptData }) {
  const hasReturns    = data.returns.length > 0;
  const totalRefunded = data.returns.reduce((s, r) => s + r.refund_amount, 0);
  const netTotal      = data.total - totalRefunded;

  // Sum of all line discounts (price overrides + explicit discount_amount)
  const totalSavings = data.items.reduce((s, item) => s + lineDiscount(item), 0);

  return (
    <div
      className="ticket-receipt bg-white text-black"
      style={{ fontFamily: "'Courier New', Courier, monospace", fontSize: "8.5pt", lineHeight: "1.3" }}
    >
      {/* ── Business header ─────────────────────────────────── */}
      <div style={{ textAlign: "center", marginBottom: "6px" }}>
        <div style={{ fontWeight: "bold", fontSize: "11pt", textTransform: "uppercase" }}>
          {data.tenant.name}
        </div>
        {data.tenant.ruc && (
          <div>RUC: {data.tenant.ruc}</div>
        )}
        {data.tenant.address && (
          <div style={{ fontSize: "7.5pt" }}>{data.tenant.address}</div>
        )}
        {data.tenant.phone && (
          <div style={{ fontSize: "7.5pt" }}>Tel: {data.tenant.phone}</div>
        )}
      </div>

      <Divider />

      {/* ── Document type + number ───────────────────────────── */}
      <div style={{ textAlign: "center", margin: "4px 0" }}>
        <div style={{ fontWeight: "bold", fontSize: "9.5pt" }}>
          {data.document_kind === "factura" ? "FACTURA" : "COMPROBANTE DE VENTA"}
        </div>
        <div style={{ fontSize: "7.5pt" }}>N° {shortId(data.id)}</div>
        {data.status === "cancelled" && (
          <div style={{ fontWeight: "bold", border: "1px solid black", padding: "1px 4px", marginTop: "2px", display: "inline-block" }}>
            *** ANULADO ***
          </div>
        )}
      </div>

      <Divider />

      {/* ── Date + customer ──────────────────────────────────── */}
      <div style={{ marginBottom: "4px" }}>
        <TicketRow label="Fecha" value={fmtDatetime(data.created_at)} />
        {data.customer && (
          <>
            <TicketRow label="Cliente" value={data.customer.full_name} />
            {data.customer.document_type !== "CONSUMIDOR_FINAL" && (
              <TicketRow
                label={data.customer.document_type}
                value={data.customer.document_number}
              />
            )}
          </>
        )}
        {data.warehouse && (
          <TicketRow label="Bodega" value={data.warehouse.name} />
        )}
      </div>

      <Divider />

      {/* ── Items ───────────────────────────────────────────── */}
      <div style={{ marginBottom: "4px" }}>
        <div style={{ fontWeight: "bold", marginBottom: "2px" }}>ARTÍCULOS</div>
        {data.items.map((item) => {
          const unitLabel  = item.presentation_label ?? (item.product_sku || "u.");
          const isCourt    = item.price_override_type === "courtesy";
          const disc       = lineDiscount(item);
          // Ticket format: always show final charged price so qty × price = line_total.
          // The discount line below communicates savings without confusing the math.
          const finalPrice = item.unit_price;
          return (
            <div key={item.id} style={{ marginBottom: "3px" }}>
              <div className="item-name" style={{ fontWeight: "bold", wordBreak: "break-word", overflowWrap: "break-word" }}>
                {item.product_name}
                {isCourt ? " [CORT.]" : ""}
              </div>
              <div style={{ paddingLeft: "4px" }}>
                <TicketLineRow
                  desc={`${item.quantity} ${unitLabel} × ${moneyFmt.format(finalPrice)}`}
                  amount={moneyFmt.format(item.line_total)}
                />
                {disc > 0.001 ? (
                  <div style={{ fontSize: "7.5pt", paddingLeft: "4px", color: "#555" }}>
                    Descuento: −{moneyFmt.format(disc)}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <Divider />

      {/* ── Totals ──────────────────────────────────────────── */}
      <div style={{ marginBottom: "4px" }}>
        <TicketRow label="Subtotal" value={moneyFmt.format(data.subtotal)} />
        {data.tax_total > 0 && (
          <TicketRow label="IVA 15%" value={moneyFmt.format(data.tax_total)} />
        )}
        {totalSavings > 0.001 && (
          <TicketRow label="Ahorros / Desc." value={`−${moneyFmt.format(totalSavings)}`} />
        )}
        <div style={{ fontWeight: "bold", fontSize: "10.5pt", display: "flex", justifyContent: "space-between", borderTop: "1px solid black", marginTop: "2px", paddingTop: "2px" }}>
          <span>TOTAL</span>
          <span>{moneyFmt.format(data.total)}</span>
        </div>
      </div>

      <Divider />

      {/* ── Payments ────────────────────────────────────────── */}
      <div style={{ marginBottom: "4px" }}>
        {data.payments.map((p, i) => (
          <TicketRow
            key={i}
            label={METHOD_LABELS[p.payment_method] ?? p.payment_method}
            value={moneyFmt.format(p.amount)}
          />
        ))}
        {/* Change: only if single cash payment > total */}
        {data.payments.length === 1 &&
          data.payments[0]?.payment_method === "cash" &&
          (data.payments[0]?.amount ?? 0) > data.total + 0.01 && (
            <TicketRow
              label="CAMBIO"
              value={moneyFmt.format((data.payments[0]?.amount ?? 0) - data.total)}
            />
          )}
      </div>

      {/* ── Returns section ─────────────────────────────────── */}
      {hasReturns && (
        <>
          <Divider />
          <div style={{ marginBottom: "4px" }}>
            <div style={{ fontWeight: "bold", marginBottom: "2px" }}>DEVOLUCIONES</div>
            {data.returns.map((r) => {
              const type =
                r.return_type === "exchange" ? "Cambio" :
                r.return_type === "full"     ? "Devolución total" : "Devolución parcial";
              return (
                <div key={r.id} style={{ marginBottom: "3px" }}>
                  <TicketRow label={type} value={`−${moneyFmt.format(r.refund_amount)}`} />
                  {r.refund_method && (
                    <div style={{ paddingLeft: "4px", fontSize: "7.5pt" }}>
                      Reimb.: {REFUND_LABELS[r.refund_method] ?? r.refund_method}
                    </div>
                  )}
                  {r.return_type === "exchange" && r.exchange_sale_id && (
                    <div style={{ paddingLeft: "4px", fontSize: "7.5pt" }}>
                      Nueva venta: #{r.exchange_sale_id.slice(0, 8).toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}
            {totalRefunded > 0 && (
              <div style={{ fontWeight: "bold", display: "flex", justifyContent: "space-between", borderTop: "1px dashed black", marginTop: "2px", paddingTop: "2px" }}>
                <span>NETO EFECTIVO</span>
                <span>{moneyFmt.format(netTotal)}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Notes ───────────────────────────────────────────── */}
      {data.notes && (
        <>
          <Divider />
          <div style={{ fontSize: "7.5pt", marginBottom: "4px" }}>
            Nota: {data.notes}
          </div>
        </>
      )}

      <Divider />

      {/* ── Footer ──────────────────────────────────────────── */}
      {(() => {
        const inv = data.invoice;
        const isPruebas  = inv?.sri_environment === "pruebas";
        const isAuthorized = inv?.status === "authorized";
        return (
          <div style={{ textAlign: "center", fontSize: "7.5pt", marginTop: "4px" }}>
            {isAuthorized && !isPruebas ? (
              <>
                <div>Comprobante electrónico SRI autorizado.</div>
                {inv?.doc_number ? <div>N° {inv.doc_number}</div> : null}
              </>
            ) : isAuthorized && isPruebas ? (
              <div style={{ fontWeight: "bold" }}>⚠ AMBIENTE PRUEBAS — sin efecto tributario.</div>
            ) : (
              <div>Documento sin validez tributaria ante el SRI.</div>
            )}
            <div style={{ color: "#555" }}>Representación comercial interna.</div>
            <div style={{ marginTop: "4px" }}>¡Gracias por su preferencia!</div>
            <div style={{ marginTop: "8px", fontSize: "7pt", color: "#666" }}>
              {data.tenant.name}
              {data.tenant.ruc ? ` · RUC ${data.tenant.ruc}` : ""}
            </div>
          </div>
        );
      })()}

      {/* Blank space at bottom for thermal cut */}
      <div style={{ height: "10mm" }} />
    </div>
  );
}

function Divider() {
  return (
    <div style={{ borderTop: "1px dashed #999", margin: "4px 0" }} />
  );
}

function TicketRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "4px" }}>
      <span style={{ color: "#444" }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

function TicketLineRow({ desc, amount }: { desc: string; amount: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "4px", fontSize: "7.5pt" }}>
      <span>{desc}</span>
      <span style={{ textAlign: "right", fontWeight: "bold" }}>{amount}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// A4 RECEIPT (formal document)
// ══════════════════════════════════════════════════════════════════════════════

function A4Receipt({ data }: { data: ReceiptData }) {
  const hasReturns    = data.returns.length > 0;
  const totalRefunded = data.returns.reduce((s, r) => s + r.refund_amount, 0);
  const hasExchange   = data.returns.some(r => r.return_type === "exchange");
  const totalSavings  = data.items.reduce((s, item) => s + lineDiscount(item), 0);

  return (
    <div
      className="a4-receipt bg-white text-black"
      style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: "10pt", lineHeight: "1.4", width: "100%" }}
    >
      {/* ── Header: business + document info ────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", borderBottom: "2px solid #1a1a1a", paddingBottom: "12px" }}>
        {/* Left: business info */}
        <div>
          <div style={{ fontSize: "16pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {data.tenant.name}
          </div>
          {data.tenant.ruc && (
            <div style={{ fontSize: "9pt", color: "#444", marginTop: "2px" }}>
              RUC: {data.tenant.ruc}
            </div>
          )}
          {data.tenant.address && (
            <div style={{ fontSize: "9pt", color: "#444" }}>{data.tenant.address}</div>
          )}
          {data.tenant.phone && (
            <div style={{ fontSize: "9pt", color: "#444" }}>Tel: {data.tenant.phone}</div>
          )}
          {data.tenant.email && (
            <div style={{ fontSize: "9pt", color: "#444" }}>{data.tenant.email}</div>
          )}
        </div>

        {/* Right: document box */}
        <div style={{ textAlign: "right", border: "2px solid #1a1a1a", padding: "8px 14px", minWidth: "200px" }}>
          <div style={{ fontWeight: "bold", fontSize: "12pt", textTransform: "uppercase" }}>
            {data.document_kind === "factura" ? "Factura" : "Comprobante de Venta"}
          </div>
          {/* If authorized factura, show SRI doc number; otherwise internal ID */}
          {data.invoice?.doc_number ? (
            <div style={{ fontSize: "10pt", fontWeight: "600", color: "#1a1a1a", marginTop: "4px" }}>
              {data.invoice.doc_number}
            </div>
          ) : (
            <div style={{ fontSize: "9pt", color: "#555", marginTop: "4px" }}>N° {shortId(data.id)}</div>
          )}
          <div style={{ fontSize: "8.5pt", color: "#777", marginTop: "2px" }}>
            {fmtDatetime(data.created_at)}
          </div>
          {data.warehouse && (
            <div style={{ fontSize: "8pt", color: "#999", marginTop: "2px" }}>
              {data.warehouse.name}
            </div>
          )}
          {/* SRI authorization block */}
          {data.invoice?.status === "authorized" && data.invoice.authorization_number ? (
            <div style={{ marginTop: "6px", paddingTop: "6px", borderTop: "1px solid #ccc", fontSize: "7.5pt", color: "#444", textAlign: "left" }}>
              <div style={{ fontWeight: "bold", textTransform: "uppercase", fontSize: "7pt", color: "#666", letterSpacing: "0.05em" }}>
                {data.invoice.sri_environment === "produccion" ? "SRI Autorizado" : "⚠ Pruebas — sin validez"}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: "6.5pt", wordBreak: "break-all", marginTop: "2px" }}>
                {data.invoice.access_key}
              </div>
              {data.invoice.authorization_date ? (
                <div style={{ marginTop: "2px" }}>
                  Auth: {fmtDatetime(data.invoice.authorization_date)}
                </div>
              ) : null}
            </div>
          ) : null}
          {data.status === "cancelled" && (
            <div style={{ fontWeight: "bold", color: "#cc0000", marginTop: "4px", fontSize: "10pt" }}>
              *** ANULADO ***
            </div>
          )}
        </div>
      </div>

      {/* ── Client info ─────────────────────────────────────── */}
      {data.customer && (
        <div style={{ marginBottom: "16px", border: "1px solid #ddd", padding: "8px 12px", backgroundColor: "#fafafa" }}>
          <div style={{ fontSize: "8pt", fontWeight: "bold", color: "#777", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
            Cliente
          </div>
          <div style={{ fontWeight: "bold", fontSize: "10.5pt" }}>
            {data.customer.full_name}
          </div>
          <div style={{ display: "flex", gap: "20px", marginTop: "2px", fontSize: "9pt", color: "#555" }}>
            {data.customer.document_type !== "CONSUMIDOR_FINAL" && (
              <span>{data.customer.document_type}: {data.customer.document_number}</span>
            )}
            {data.customer.phone && <span>Tel: {data.customer.phone}</span>}
          </div>
        </div>
      )}

      {/* ── Line items table ─────────────────────────────────── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "16px" }}>
        <thead>
          <tr style={{ backgroundColor: "#1a1a1a", color: "white" }}>
            <th style={{ padding: "6px 8px", textAlign: "left",  fontSize: "8.5pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.06em" }}>Producto</th>
            <th style={{ padding: "6px 8px", textAlign: "center",fontSize: "8.5pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.06em", width: "60px" }}>Cant.</th>
            <th style={{ padding: "6px 8px", textAlign: "right", fontSize: "8.5pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.06em", width: "80px" }}>P. Unit.</th>
            <th style={{ padding: "6px 8px", textAlign: "right", fontSize: "8.5pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.06em", width: "80px" }}>Desc.</th>
            <th style={{ padding: "6px 8px", textAlign: "right", fontSize: "8.5pt", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.06em", width: "90px" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item, idx) => {
            const unitLabel  = item.presentation_label ?? "u.";
            const isCourt    = item.price_override_type === "courtesy";
            const isCombo    = item.price_override_type === "combo";
            const disc       = lineDiscount(item);
            const listPrice  = displayUnitPrice(item);
            const hasOverride = item.original_unit_price != null && item.original_unit_price > item.unit_price;
            return (
              <tr
                key={item.id}
                style={{ backgroundColor: idx % 2 === 0 ? "white" : "#f8f8f8", borderBottom: "1px solid #eee" }}
              >
                <td style={{ padding: "6px 8px", verticalAlign: "top" }}>
                  <div style={{ fontWeight: "600" }}>{item.product_name}</div>
                  <div style={{ fontSize: "8pt", color: "#888" }}>
                    {item.product_sku}
                    {item.base_qty !== 1 ? ` · ${item.base_qty} u.b.` : ""}
                    {isCourt ? " · CORTESÍA" : ""}
                    {isCombo  ? " · COMBO"    : ""}
                  </div>
                </td>
                <td style={{ padding: "6px 8px", textAlign: "center", verticalAlign: "top", fontFamily: "monospace" }}>
                  {item.quantity} {unitLabel}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", verticalAlign: "top", fontFamily: "monospace" }}>
                  {moneyFmt.format(listPrice)}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", verticalAlign: "top", fontFamily: "monospace", color: "#888" }}>
                  {disc > 0.001 ? `−${moneyFmt.format(disc)}` : "—"}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", verticalAlign: "top", fontFamily: "monospace", fontWeight: "bold" }}>
                  {moneyFmt.format(item.line_total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* ── Totals + Payments row ────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "20px", marginBottom: "16px", alignItems: "flex-start" }}>

        {/* Left: Payments */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "8pt", fontWeight: "bold", color: "#777", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
            Forma de pago
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {data.payments.map((p, i) => (
                <tr key={i}>
                  <td style={{ padding: "3px 0", fontSize: "9.5pt" }}>
                    {METHOD_LABELS[p.payment_method] ?? p.payment_method}
                    {p.reference ? <span style={{ color: "#888", fontSize: "8.5pt" }}> · {p.reference}</span> : null}
                  </td>
                  <td style={{ padding: "3px 0", textAlign: "right", fontFamily: "monospace", fontSize: "9.5pt", paddingLeft: "16px" }}>
                    {moneyFmt.format(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Notes */}
          {data.notes && (
            <div style={{ marginTop: "10px", fontSize: "8.5pt", color: "#666", borderTop: "1px solid #eee", paddingTop: "6px" }}>
              Nota: {data.notes}
            </div>
          )}
        </div>

        {/* Right: Totals box */}
        <div style={{ minWidth: "220px", border: "1px solid #ddd" }}>
          <TotalRow label="Subtotal (sin IVA)" value={moneyFmt.format(data.subtotal)} />
          {data.tax_total > 0 && (
            <TotalRow label="IVA 15%" value={moneyFmt.format(data.tax_total)} />
          )}
          {totalSavings > 0.001 && (
            <TotalRow label="Ahorros / Desc." value={`−${moneyFmt.format(totalSavings)}`} muted />
          )}
          {hasReturns && totalRefunded > 0 && (
            <TotalRow label="Reembolsado" value={`−${moneyFmt.format(totalRefunded)}`} muted />
          )}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", backgroundColor: "#1a1a1a", color: "white", fontWeight: "bold", fontSize: "11.5pt" }}>
            <span>TOTAL</span>
            <span style={{ fontFamily: "monospace" }}>{moneyFmt.format(data.total)}</span>
          </div>
        </div>
      </div>

      {/* ── Returns section ─────────────────────────────────── */}
      {hasReturns && (
        <div style={{ marginBottom: "16px", border: "1px solid #e5a800", backgroundColor: "#fffbf0", padding: "10px 14px" }}>
          <div style={{ fontWeight: "bold", fontSize: "9.5pt", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px", color: "#92700a" }}>
            Devoluciones registradas
          </div>
          {data.returns.map((r) => {
            const type =
              r.return_type === "exchange" ? "Cambio de producto" :
              r.return_type === "full"     ? "Devolución total"   : "Devolución parcial";
            const cedido = Math.max(0, Number(
              (r.refund_amount - r.exchange_credit_applied - r.exchange_credit_refunded).toFixed(2)
            ));
            return (
              <div key={r.id} style={{ marginBottom: "8px", paddingBottom: "8px", borderBottom: "1px dashed #e5c87a" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "600" }}>
                  <span>{type} · {fmtDatetime(r.processed_at)}</span>
                  <span style={{ fontFamily: "monospace" }}>−{moneyFmt.format(r.refund_amount)}</span>
                </div>
                <div style={{ fontSize: "8.5pt", color: "#666", marginTop: "2px" }}>
                  Motivo: {r.reason}
                </div>
                {r.refund_method && (
                  <div style={{ fontSize: "8.5pt", color: "#666" }}>
                    Reembolso: {REFUND_LABELS[r.refund_method] ?? r.refund_method}
                  </div>
                )}
                {r.return_type === "exchange" && (
                  <div style={{ marginTop: "4px", fontSize: "8.5pt" }}>
                    {r.exchange_credit_applied > 0 && (
                      <span style={{ marginRight: "12px" }}>
                        Aplicado a cambio: {moneyFmt.format(r.exchange_credit_applied)}
                      </span>
                    )}
                    {r.exchange_credit_refunded > 0 && (
                      <span style={{ marginRight: "12px" }}>
                        Reembolsado en caja: {moneyFmt.format(r.exchange_credit_refunded)}
                      </span>
                    )}
                    {cedido > 0.005 && (
                      <span style={{ color: "#92700a" }}>
                        Crédito cedido: {moneyFmt.format(cedido)}
                      </span>
                    )}
                    {r.exchange_sale_id && (
                      <div>
                        Venta de reemplazo: #{r.exchange_sale_id.slice(0, 8).toUpperCase()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────── */}
      {(() => {
        const inv        = data.invoice;
        const isAuth     = inv?.status === "authorized";
        const isPruebas  = inv?.sri_environment === "pruebas";
        return (
          <div className="a4-footer" style={{ borderTop: "1px solid #ccc", marginTop: "24px", paddingTop: "10px", fontSize: "7.5pt", color: "#888", textAlign: "center" }}>
            {isAuth && !isPruebas ? (
              <div style={{ fontWeight: "bold", color: "#1a1a1a" }}>
                Comprobante electrónico autorizado por el Servicio de Rentas Internas del Ecuador.
              </div>
            ) : isAuth && isPruebas ? (
              <div style={{ fontWeight: "bold", color: "#b45309" }}>
                ⚠ AMBIENTE DE PRUEBAS — Este comprobante no tiene efecto tributario.
              </div>
            ) : (
              <div style={{ fontWeight: "bold" }}>
                ESTE DOCUMENTO NO TIENE VALIDEZ TRIBUTARIA ANTE EL SRI
              </div>
            )}
            {!isAuth ? (
              <div>Representación impresa de uso interno · no sustituye comprobante de venta.</div>
            ) : null}
            <div style={{ marginTop: "4px" }}>
              {data.tenant.name}
              {data.tenant.ruc ? ` · RUC ${data.tenant.ruc}` : ""}
              {data.tenant.address ? ` · ${data.tenant.address}` : ""}
            </div>
            <div style={{ marginTop: "2px", fontSize: "7pt" }}>
              Impreso: {fmtDatetime(new Date().toISOString())}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RIDE — Representación Impresa del Documento Electrónico (SRI Ecuador)
// ══════════════════════════════════════════════════════════════════════════════

function RideReceipt({ data }: { data: ReceiptData }) {
  const inv = data.invoice;
  if (!inv?.doc_number || !inv?.access_key) {
    return (
      <div className="ride-receipt bg-white text-black" style={{ fontFamily: "Arial, sans-serif", padding: "20px" }}>
        <p style={{ color: "#cc0000" }}>Este documento no tiene una factura electrónica emitida.</p>
        <p style={{ fontSize: "9pt", color: "#666" }}>Use "A4 formal" para imprimir la nota de venta.</p>
      </div>
    );
  }

  // Compose RideInput from ReceiptData
  const rideInput: RideInput = {
    saleDate:              data.sale_date,
    docNumber:             inv.doc_number,
    accessKey:             inv.access_key,
    authNumber:            inv.authorization_number,
    authDate:              inv.authorization_date,
    sri_environment:       inv.sri_environment as "pruebas" | "produccion",
    status:                inv.status,
    ruc:                   data.tenant.ruc ?? "",
    razonSocial:           data.fiscalConfig?.razon_social ?? data.tenant.name,
    nombreComercial:       data.tenant.name,
    dirMatriz:             data.fiscalConfig?.dir_matriz ?? data.tenant.address ?? "",
    dirEstab:              data.fiscalConfig?.dir_estab ?? null,
    obligadoContabilidad:  data.fiscalConfig?.obligado_contabilidad ?? false,
    contribuyenteEspecial: data.fiscalConfig?.contribuyente_especial ?? null,
    buyerDocType:          data.customer?.document_type ?? null,
    buyerName:             data.customer?.full_name     ?? null,
    buyerDocNumber:        data.customer?.document_number ?? null,
    buyerPhone:            data.customer?.phone ?? null,
    items: data.items.map((i) => ({
      product_name:       i.product_name,
      product_sku:        i.product_sku,
      quantity:           i.quantity,
      line_total:         i.line_total,
      is_taxable:         i.is_taxable,
      tax_rate:           i.tax_rate,
      presentation_label: i.presentation_label,
    })),
    payments:      data.payments.map((p) => ({ method: p.payment_method, amount: p.amount })),
    discountTotal: data.discount_total,
    importeTotal:  data.total,
    warehouseName: data.warehouse?.name ?? null,
    saleNotes:     data.notes,
  };

  const vm = buildRideViewModel(rideInput);

  const cellStyle: React.CSSProperties = {
    padding: "3px 5px",
    border: "1px solid #ccc",
    fontSize: "7.5pt",
    verticalAlign: "top",
  };
  const headerCellStyle: React.CSSProperties = {
    ...cellStyle,
    backgroundColor: "#1a1a1a",
    color: "white",
    fontWeight: "bold",
    textTransform: "uppercase" as const,
    fontSize: "7pt",
    letterSpacing: "0.04em",
  };

  return (
    <div
      className="ride-receipt bg-white text-black"
      style={{ fontFamily: "Arial, Helvetica, sans-serif", fontSize: "8.5pt", lineHeight: "1.3", width: "100%" }}
    >
      {/* ── Environment warning ──────────────────────────────── */}
      {!vm.isAuthorized && (
        <div style={{ backgroundColor: "#fef3c7", border: "2px solid #f59e0b", padding: "5px 10px", marginBottom: "8px", fontWeight: "bold", fontSize: "8pt", color: "#92400e", textAlign: "center" }}>
          {vm.environment === "pruebas"
            ? "⚠  AMBIENTE DE PRUEBAS — COMPROBANTE SIN EFECTO TRIBUTARIO"
            : `Estado: ${vm.status.toUpperCase()} — No autorizado`}
        </div>
      )}

      {/* ── Header (2-column) ────────────────────────────────── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px", border: "1px solid #999" }}>
        <tbody>
          <tr>
            {/* Left: Issuer info */}
            <td style={{ width: "55%", padding: "8px 10px", verticalAlign: "top", borderRight: "1px solid #999" }}>
              <div style={{ fontWeight: "bold", fontSize: "12pt", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                {vm.razonSocial}
              </div>
              {vm.nombreComercial !== vm.razonSocial && (
                <div style={{ fontSize: "9pt", color: "#555", marginTop: "1px" }}>
                  Nombre Comercial: {vm.nombreComercial}
                </div>
              )}
              <div style={{ marginTop: "4px", fontSize: "7.5pt" }}>
                <RideRow label="Dir. Matriz"           value={vm.dirMatriz} />
                {vm.dirEstab !== vm.dirMatriz && (
                  <RideRow label="Dir. Establecimiento" value={vm.dirEstab} />
                )}
                {vm.contribuyenteEspecial && (
                  <RideRow label="Contribuyente Especial" value={vm.contribuyenteEspecial} />
                )}
                <RideRow label="Obligado a llevar Contabilidad" value={vm.obligadoLabel} />
                <RideRow label="Ambiente"    value={vm.envLabel} />
                <RideRow label="Tipo Emisión" value="EMISIÓN NORMAL" />
              </div>
            </td>

            {/* Right: Document identification box */}
            <td style={{ width: "45%", padding: "8px 10px", verticalAlign: "top", backgroundColor: "#fafafa" }}>
              <div style={{ textAlign: "center", marginBottom: "6px" }}>
                <div style={{ fontSize: "8pt", color: "#666", marginBottom: "1px" }}>R.U.C.</div>
                <div style={{ fontWeight: "bold", fontSize: "11pt", letterSpacing: "0.05em" }}>
                  {vm.ruc}
                </div>
              </div>
              <div style={{ textAlign: "center", borderTop: "1px solid #ccc", paddingTop: "5px", marginBottom: "5px" }}>
                <div style={{ fontWeight: "bold", fontSize: "11pt", textTransform: "uppercase" }}>
                  {vm.docType}
                </div>
                <div style={{ fontWeight: "bold", fontSize: "9.5pt", fontFamily: "monospace", marginTop: "2px" }}>
                  {vm.docNumber}
                </div>
              </div>
              {vm.isAuthorized && vm.authNumber && (
                <div style={{ borderTop: "1px solid #ccc", paddingTop: "4px", marginTop: "4px", fontSize: "7pt" }}>
                  <div style={{ color: "#666", textTransform: "uppercase", fontWeight: "bold", letterSpacing: "0.05em" }}>
                    Número de Autorización
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: "7pt", wordBreak: "break-all", marginTop: "1px" }}>
                    {vm.authNumber}
                  </div>
                  {vm.authDateFmt && (
                    <div style={{ marginTop: "2px" }}>
                      <span style={{ color: "#666" }}>Fecha y Hora de Autorización: </span>
                      {vm.authDateFmt}
                    </div>
                  )}
                </div>
              )}
              {/* Access key */}
              <div style={{ borderTop: "1px solid #ccc", paddingTop: "4px", marginTop: "4px" }}>
                <div style={{ color: "#666", fontSize: "6.5pt", textTransform: "uppercase", fontWeight: "bold", letterSpacing: "0.05em", marginBottom: "2px" }}>
                  Clave de Acceso
                </div>
                <div style={{
                  fontFamily: "Courier New, monospace",
                  fontSize: "6pt",
                  wordBreak: "break-all",
                  letterSpacing: "0.08em",
                  backgroundColor: "#f5f5f5",
                  padding: "3px 4px",
                  border: "1px solid #ddd",
                  lineHeight: "1.6",
                }}>
                  {vm.accessKeyFmt}
                </div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Buyer info ────────────────────────────────────────── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6px", border: "1px solid #ccc" }}>
        <tbody>
          <tr>
            <td style={{ padding: "4px 8px", width: "50%", borderRight: "1px solid #ccc" }}>
              <span style={{ color: "#666", fontSize: "7pt", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Razón Social / Nombres y Apellidos
              </span>
              <div style={{ fontWeight: "bold", marginTop: "1px" }}>{vm.buyerName}</div>
            </td>
            <td style={{ padding: "4px 8px", width: "30%", borderRight: "1px solid #ccc" }}>
              <span style={{ color: "#666", fontSize: "7pt", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Identificación
              </span>
              <div style={{ fontWeight: "bold", marginTop: "1px", fontFamily: "monospace" }}>{vm.buyerDoc}</div>
            </td>
            <td style={{ padding: "4px 8px", width: "20%" }}>
              <span style={{ color: "#666", fontSize: "7pt", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Fecha Emisión
              </span>
              <div style={{ fontWeight: "bold", marginTop: "1px" }}>{vm.fechaEmisionFmt}</div>
            </td>
          </tr>
          <tr style={{ borderTop: "1px solid #eee" }}>
            <td style={{ padding: "4px 8px", borderRight: "1px solid #ccc" }}>
              <span style={{ color: "#666", fontSize: "7pt", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Tipo Identificación
              </span>
              <div style={{ marginTop: "1px" }}>{vm.buyerIdTypeLabel}</div>
            </td>
            {vm.buyerPhone && (
              <td style={{ padding: "4px 8px", borderRight: "1px solid #ccc" }}>
                <span style={{ color: "#666", fontSize: "7pt", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Teléfono
                </span>
                <div style={{ marginTop: "1px" }}>{vm.buyerPhone}</div>
              </td>
            )}
            <td colSpan={vm.buyerPhone ? 1 : 2} style={{ padding: "4px 8px" }}>
              <span style={{ color: "#666", fontSize: "7pt", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Guía Remisión
              </span>
              <div style={{ marginTop: "1px", color: "#999" }}>—</div>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Line items table ──────────────────────────────────── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px", fontSize: "7.5pt" }}>
        <thead>
          <tr>
            <th style={{ ...headerCellStyle, width: "22px", textAlign: "center" }}>N°</th>
            <th style={{ ...headerCellStyle, width: "80px" }}>Cód. Principal</th>
            <th style={{ ...headerCellStyle, width: "60px" }}>Cód. Auxiliar</th>
            <th style={{ ...headerCellStyle }}>Descripción</th>
            <th style={{ ...headerCellStyle, width: "55px", textAlign: "right" }}>Cantidad</th>
            <th style={{ ...headerCellStyle, width: "70px", textAlign: "right" }}>P. Unitario</th>
            <th style={{ ...headerCellStyle, width: "55px", textAlign: "right" }}>Descuento</th>
            <th style={{ ...headerCellStyle, width: "72px", textAlign: "right" }}>P. Total S/IVA</th>
          </tr>
        </thead>
        <tbody>
          {vm.items.map((item, idx) => (
            <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? "white" : "#f8f8f8" }}>
              <td style={{ ...cellStyle, textAlign: "center", color: "#888" }}>{item.seq}</td>
              <td style={{ ...cellStyle, fontFamily: "monospace", fontSize: "7pt" }}>{item.codigoPrincipal}</td>
              <td style={{ ...cellStyle, fontSize: "7pt" }}>{item.codigoAuxiliar || "—"}</td>
              <td style={{ ...cellStyle, fontWeight: 500 }}>{item.descripcion}</td>
              <td style={{ ...cellStyle, textAlign: "right", fontFamily: "monospace" }}>{item.cantidad}</td>
              <td style={{ ...cellStyle, textAlign: "right", fontFamily: "monospace" }}>{item.precioUnitario}</td>
              <td style={{ ...cellStyle, textAlign: "right", fontFamily: "monospace", color: "#888" }}>{item.descuento}</td>
              <td style={{ ...cellStyle, textAlign: "right", fontFamily: "monospace", fontWeight: "bold" }}>
                {item.precioTotalSinImpuesto}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Payments + Totals (2-column) ──────────────────────── */}
      <div className="ride-totals-block" style={{ display: "flex", gap: "10px", marginBottom: "8px", alignItems: "flex-start" }}>

        {/* Left: Forma de pago */}
        <div style={{ flex: 1 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "7.5pt" }}>
            <thead>
              <tr>
                <th style={{ ...headerCellStyle, textAlign: "left" }}>Forma de Pago</th>
                <th style={{ ...headerCellStyle, textAlign: "right", width: "70px" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {vm.payments.map((p, i) => (
                <tr key={i}>
                  <td style={{ ...cellStyle }}>{p.label}</td>
                  <td style={{ ...cellStyle, textAlign: "right", fontFamily: "monospace" }}>{p.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Right: Totals */}
        <div style={{ minWidth: "200px", border: "1px solid #ccc" }}>
          <RideTotalRow label="Subtotal IVA 0%"               value={vm.subtotal0} />
          <RideTotalRow label="Subtotal No Objeto de IVA"     value="0.00" muted />
          <RideTotalRow label="Subtotal Exento de IVA"        value="0.00" muted />
          <RideTotalRow label="Subtotal 15%"                  value={vm.subtotal15} />
          <RideTotalRow label="Descuento"                     value={vm.totalDescuento} />
          <RideTotalRow label="ICE"                           value="0.00" muted />
          <RideTotalRow label="IRBPNR"                        value="0.00" muted />
          <RideTotalRow label="IVA 15%"                       value={vm.iva15} />
          <RideTotalRow label="Propina"                       value={vm.propina} muted />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 8px", backgroundColor: "#1a1a1a", color: "white", fontWeight: "bold", fontSize: "9pt" }}>
            <span>VALOR TOTAL</span>
            <span style={{ fontFamily: "monospace" }}>{vm.importeTotal}</span>
          </div>
        </div>
      </div>

      {/* ── Additional info ───────────────────────────────────── */}
      {vm.camposAdicionales.length > 0 && (
        <table style={{ width: "60%", borderCollapse: "collapse", fontSize: "7.5pt", marginBottom: "8px" }}>
          <thead>
            <tr>
              <th style={{ ...headerCellStyle, textAlign: "left" }}>Información Adicional</th>
              <th style={{ ...headerCellStyle, textAlign: "left" }}>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {vm.camposAdicionales.map((c, i) => (
              <tr key={i}>
                <td style={{ ...cellStyle, color: "#666" }}>{c.nombre}</td>
                <td style={{ ...cellStyle }}>{c.valor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Footer ───────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid #ccc", paddingTop: "6px", fontSize: "7pt", color: "#888", textAlign: "center" }}>
        {vm.isAuthorized && vm.environment === "produccion" ? (
          <div style={{ fontWeight: "bold", color: "#1a1a1a" }}>
            Comprobante electrónico autorizado por el Servicio de Rentas Internas del Ecuador.
          </div>
        ) : (
          <div style={{ fontWeight: "bold", color: "#b45309" }}>
            {vm.environment === "pruebas"
              ? "⚠ AMBIENTE DE PRUEBAS — Este comprobante no tiene efecto tributario."
              : "Comprobante pendiente de autorización."}
          </div>
        )}
        <div style={{ marginTop: "2px" }}>
          {vm.razonSocial} · RUC {vm.ruc}
          {vm.dirMatriz ? ` · ${vm.dirMatriz}` : ""}
        </div>
        <div style={{ marginTop: "2px", fontSize: "6.5pt" }}>
          Impreso: {fmtDatetime(new Date().toISOString())}
        </div>
      </div>
    </div>
  );
}

function RideRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "4px", marginBottom: "1px" }}>
      <span style={{ color: "#666", minWidth: "110px", flexShrink: 0 }}>{label}:</span>
      <span>{value}</span>
    </div>
  );
}

function RideTotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "3px 8px", borderBottom: "1px solid #eee",
      color: muted ? "#aaa" : "inherit",
    }}>
      <span style={{ fontSize: "7.5pt" }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontSize: "7.5pt" }}>{value}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ══════════════════════════════════════════════════════════════════════════════

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", borderBottom: "1px solid #eee", color: muted ? "#888" : "inherit" }}>
      <span style={{ fontSize: "9pt" }}>{label}</span>
      <span style={{ fontFamily: "monospace", fontSize: "9.5pt" }}>{value}</span>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function PrinterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}
