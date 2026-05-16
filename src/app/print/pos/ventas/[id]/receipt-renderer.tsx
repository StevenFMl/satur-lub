"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────

export type ReceiptItem = {
  id:                  string;
  product_name:        string;
  product_sku:         string;
  quantity:            number;
  unit_price:          number;
  line_total:          number;
  discount_amount:     number;
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
  format:        "ticket" | "a4";
  saleId:        string;
}) {
  const router     = useRouter();
  const [fmt, setFmt] = React.useState<"ticket" | "a4">(initialFormat);

  // Auto-print on mount with a small delay for fonts to load
  React.useEffect(() => {
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, []);

  const switchFormat = (next: "ticket" | "a4") => {
    setFmt(next);
    router.replace(`?format=${next}`, { scroll: false });
  };

  const ticketCss = `
    @page { size: 80mm auto; margin: 2mm 3mm; }
    @media print {
      body { background: white !important; }
      .no-print { display: none !important; }
      .ticket-receipt { width: 76mm; font-size: 8.5pt; }
      .a4-receipt { display: none !important; }
    }
  `;

  const a4Css = `
    @page { size: A4 portrait; margin: 15mm 18mm; }
    @media print {
      body { background: white !important; }
      .no-print { display: none !important; }
      .ticket-receipt { display: none !important; }
      .a4-receipt { width: 100%; font-size: 10pt; }
    }
  `;

  return (
    <>
      <style>{fmt === "ticket" ? ticketCss : a4Css}</style>

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
          : <A4Receipt     data={data} />}
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
          const unitLabel    = item.presentation_label ?? (item.product_sku || "u.");
          const effectivePrice = item.line_total / (item.quantity || 1);
          const isCourt      = item.price_override_type === "courtesy";
          return (
            <div key={item.id} style={{ marginBottom: "3px" }}>
              <div style={{ fontWeight: "bold" }}>
                {item.product_name}
                {isCourt ? " [CORT.]" : ""}
              </div>
              <div style={{ paddingLeft: "4px" }}>
                <TicketLineRow
                  desc={`${item.quantity} ${unitLabel} × ${moneyFmt.format(item.unit_price)}`}
                  amount={moneyFmt.format(item.line_total)}
                />
                {item.discount_amount > 0 && (
                  <div style={{ fontSize: "7.5pt", paddingLeft: "4px" }}>
                    Descuento: −{moneyFmt.format(item.discount_amount)}
                  </div>
                )}
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
        {data.discount_total > 0 && (
          <TicketRow label="Descuento" value={`−${moneyFmt.format(data.discount_total)}`} />
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
      <div style={{ textAlign: "center", fontSize: "7.5pt", marginTop: "4px" }}>
        <div>Documento no válido como comprobante SRI.</div>
        <div>Representación impresa — no tributaria.</div>
        <div style={{ marginTop: "4px" }}>¡Gracias por su preferencia!</div>
        <div style={{ marginTop: "8px", fontSize: "7pt", color: "#666" }}>
          SaturnLub · satur-lub.com
        </div>
      </div>

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
        <div style={{ textAlign: "right", border: "2px solid #1a1a1a", padding: "8px 14px", minWidth: "180px" }}>
          <div style={{ fontWeight: "bold", fontSize: "12pt", textTransform: "uppercase" }}>
            {data.document_kind === "factura" ? "Factura" : "Comprobante de Venta"}
          </div>
          <div style={{ fontSize: "9pt", color: "#555", marginTop: "4px" }}>N° {shortId(data.id)}</div>
          <div style={{ fontSize: "8.5pt", color: "#777", marginTop: "2px" }}>
            {fmtDatetime(data.created_at)}
          </div>
          {data.warehouse && (
            <div style={{ fontSize: "8pt", color: "#999", marginTop: "2px" }}>
              {data.warehouse.name}
            </div>
          )}
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
            const unitLabel = item.presentation_label ?? "u.";
            const isCourt   = item.price_override_type === "courtesy";
            const isCombo   = item.price_override_type === "combo";
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
                  {moneyFmt.format(item.unit_price)}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", verticalAlign: "top", fontFamily: "monospace", color: "#888" }}>
                  {item.discount_amount > 0 ? `−${moneyFmt.format(item.discount_amount)}` : "—"}
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
          {data.discount_total > 0 && (
            <TotalRow label="Descuento" value={`−${moneyFmt.format(data.discount_total)}`} />
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
      <div style={{ borderTop: "1px solid #ccc", marginTop: "auto", paddingTop: "10px", fontSize: "7.5pt", color: "#888", textAlign: "center" }}>
        <div style={{ fontWeight: "bold" }}>
          DOCUMENTO NO VÁLIDO COMO COMPROBANTE DE VENTA ANTE EL SRI
        </div>
        <div>Representación impresa — uso interno / referencia comercial.</div>
        {data.tenant.ruc && (
          <div style={{ marginTop: "4px" }}>
            {data.tenant.name} · RUC {data.tenant.ruc}
          </div>
        )}
        <div style={{ marginTop: "2px", fontSize: "7pt" }}>
          Emitido: {fmtDatetime(new Date().toISOString())} · SaturnLub
        </div>
        {/* SRI/RIDE placeholder — to be completed when electronic billing is implemented */}
        {/* Future: clave_acceso, numero_autorizacion, fecha_autorizacion, QR code */}
      </div>
    </div>
  );
}

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
