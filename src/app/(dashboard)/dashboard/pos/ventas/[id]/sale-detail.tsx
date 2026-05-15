"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SaleDetailData } from "./page";
import { PRICE_OVERRIDE_LABELS, type PriceOverrideType } from "@/lib/validations/sale";
import { REFUND_METHOD_LABELS, type RefundMethod } from "@/lib/validations/sale-return";
import { VoidDialog } from "../void-dialog";
import { ReturnDialog } from "./return-dialog";

// ── Formatters ──────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia",
};

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString("es-EC", {
    timeZone: "America/Guayaquil",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtDate(iso: string) {
  // Append T12:00:00Z (noon UTC) to avoid UTC-midnight crossing back to
  // the previous day in Ecuador (UTC-5) when formatting as a local date.
  return new Date(iso + "T12:00:00Z").toLocaleDateString("es-EC", {
    timeZone: "America/Guayaquil",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

// ── Main component ──────────────────────────────────────────────────────────

export function SaleDetail({
  sale,
  canVoidSale,
  canProcessReturn,
  canSetNoRestock,
  cashSessionId,
}: {
  sale:             SaleDetailData;
  canVoidSale:      boolean;
  canProcessReturn: boolean;
  canSetNoRestock:  boolean;
  cashSessionId:    string | null;
}) {
  const router                    = useRouter();
  const [voidOpen,   setVoidOpen]   = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);

  const isCancelled   = sale.status === "cancelled";
  const hasOverride   = sale.items.some((i) => i.original_unit_price != null);
  const hasReturns    = sale.returns.length > 0;
  const hasReturnableItems = sale.items.some((i) => i.available_to_return > 0);

  // Total already refunded across all returns
  const totalRefunded = sale.returns.reduce((s, r) => s + r.refund_amount, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[22px] tracking-[0.04em]">VENTA</h1>
            <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
              #{sale.id.slice(0, 8).toUpperCase()}
            </span>
            <StatusChip status={sale.status} returnStatus={sale.returnStatus} />
          </div>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {fmtDate(sale.sale_date)} · registrada {fmtDatetime(sale.created_at)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          <Link
            href="/dashboard/pos/ventas"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            ← Historial
          </Link>

          {/* Return button */}
          {canProcessReturn && !isCancelled && hasReturnableItems ? (
            <button
              id="btn-register-return"
              type="button"
              onClick={() => setReturnOpen(true)}
              className="h-8 rounded-sm border border-safety-500/40 bg-safety-500/5 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-safety-500 transition-colors hover:bg-safety-500/10"
            >
              Registrar devolución
            </button>
          ) : null}

          {/* Void button */}
          {canVoidSale && !isCancelled ? (
            <button
              id="btn-void-sale"
              type="button"
              onClick={() => setVoidOpen(true)}
              className="h-8 rounded-sm border border-red-500/40 bg-red-500/5 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-red-400 transition-colors hover:bg-red-500/10"
            >
              Anular venta
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Cancellation notice ─────────────────────────────────── */}
      {isCancelled ? (
        <div className="rounded-sm border border-red-500/30 bg-red-500/5 px-4 py-3 space-y-1">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-red-400">
            Venta anulada · {fmtDatetime(sale.cancelled_at ?? "")}
          </p>
          {sale.cancellation_reason ? (
            <p className="text-[12.5px] text-foreground">{sale.cancellation_reason}</p>
          ) : null}
          {sale.cancellation_note ? (
            <p className="text-[11.5px] text-muted-foreground">{sale.cancellation_note}</p>
          ) : null}
        </div>
      ) : null}

      {/* ── Returns summary notice ─────────────────────────────── */}
      {hasReturns && !isCancelled ? (
        <div className="rounded-sm border border-signal-600/30 bg-signal-900/20 px-4 py-3 space-y-1">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-signal-400">
            {sale.returnStatus === "full"
              ? "Venta devuelta totalmente"
              : `Devolución parcial · ${sale.returns.length} registro${sale.returns.length > 1 ? "s" : ""}`}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">
            Total reembolsado: <strong className="text-foreground">{moneyFmt.format(totalRefunded)}</strong>
          </p>
        </div>
      ) : null}

      {/* ── Two-column layout on desktop ───────────────────────── */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_260px]">

        {/* ── Items ───────────────────────────────────────────── */}
        <div className="space-y-3">
          <SectionTitle>Ítems</SectionTitle>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-sm border border-steel-700 sm:block">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-steel-700 bg-steel-900/60">
                  {["Producto", "Cant.", "Precio", "Total"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/70">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-steel-800/40">
                {sale.items.map((item) => {
                  const unitLabel      = item.presentation_label ?? item.product_unit;
                  const hasItemOverride = item.original_unit_price != null;
                  const fullyReturned  = item.available_to_return === 0 && item.already_returned > 0;
                  return (
                    <tr key={item.id} className={fullyReturned ? "opacity-50" : ""}>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-foreground">{item.product_name}</div>
                        <div className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground/60">
                          {item.product_sku}
                          {item.base_qty !== 1 ? ` · ${item.base_qty} u.b.` : ""}
                        </div>
                        {hasItemOverride ? (
                          <div className="mt-0.5 font-mono text-[9.5px] text-signal-400">
                            {PRICE_OVERRIDE_LABELS[(item.price_override_type ?? "price_set") as PriceOverrideType]}
                            {item.price_override_reason ? ` · ${item.price_override_reason}` : ""}
                          </div>
                        ) : null}
                        {/* Return status chips */}
                        {item.already_returned > 0 ? (
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            <span className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] text-signal-400">
                              Devuelto: {item.already_returned} {unitLabel}
                            </span>
                            {item.available_to_return > 0 && (
                              <span className="rounded-sm border border-steel-600/40 bg-steel-700/10 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground/70">
                                Disp.: {item.available_to_return}
                              </span>
                            )}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-muted-foreground">
                        {item.quantity} {unitLabel}
                      </td>
                      <td className="px-3 py-2.5">
                        {hasItemOverride ? (
                          <div>
                            <div className="font-mono text-[10px] line-through text-muted-foreground/40">
                              {moneyFmt.format(item.original_unit_price as number)}
                            </div>
                            <div className="font-mono text-[11.5px] font-semibold text-signal-400 tabular-nums">
                              {moneyFmt.format(item.unit_price)}
                            </div>
                          </div>
                        ) : (
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {moneyFmt.format(item.unit_price)}
                          </span>
                        )}
                        {item.discount_amount > 0 ? (
                          <div className="font-mono text-[9.5px] text-muted-foreground/50">
                            −{moneyFmt.format(item.discount_amount)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 font-mono font-bold tabular-nums text-foreground">
                        {moneyFmt.format(item.line_total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile item cards */}
          <div className="space-y-2 sm:hidden">
            {sale.items.map((item) => {
              const unitLabel      = item.presentation_label ?? item.product_unit;
              const hasItemOverride = item.original_unit_price != null;
              const fullyReturned  = item.available_to_return === 0 && item.already_returned > 0;
              return (
                <div
                  key={item.id}
                  className={[
                    "rounded-sm border border-steel-700 bg-steel-900/40 px-3 py-2.5",
                    fullyReturned ? "opacity-50" : "",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-foreground">{item.product_name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {item.quantity} {unitLabel} ×{" "}
                        {hasItemOverride ? (
                          <>
                            <span className="line-through text-muted-foreground/40">{moneyFmt.format(item.original_unit_price as number)}</span>
                            {" "}<span className="text-signal-400">{moneyFmt.format(item.unit_price)}</span>
                          </>
                        ) : moneyFmt.format(item.unit_price)}
                      </div>
                      {item.already_returned > 0 && (
                        <span className="mt-0.5 inline-block rounded-sm border border-signal-600/40 bg-signal-700/10 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] text-signal-400">
                          Devuelto: {item.already_returned}
                        </span>
                      )}
                    </div>
                    <span className="font-mono font-bold tabular-nums text-foreground">
                      {moneyFmt.format(item.line_total)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {hasOverride ? (
            <div className="rounded-sm border border-signal-700/30 bg-signal-900/20 px-3 py-2">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-signal-500/70">
                Esta venta incluyó ajustes de precio
              </p>
            </div>
          ) : null}

          {/* ── Previous returns ──────────────────────────────── */}
          {hasReturns ? (
            <div className="space-y-2 pt-1">
              <SectionTitle>Devoluciones registradas</SectionTitle>
              {sale.returns.map((ret) => (
                <div
                  key={ret.id}
                  className="rounded-sm border border-signal-700/30 bg-signal-900/10 px-4 py-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-signal-400/70">
                        {ret.return_type === "full"
                          ? "Devolución total"
                          : ret.return_type === "exchange"
                          ? "Cambio"
                          : "Devolución parcial"}{" "}
                        · {fmtDatetime(ret.processed_at)}
                      </span>
                      <p className="mt-0.5 text-[12.5px] text-foreground">{ret.reason}</p>
                      {ret.notes ? (
                        <p className="text-[11.5px] text-muted-foreground">{ret.notes}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-display text-[18px] leading-none text-safety-500">
                        {moneyFmt.format(ret.refund_amount)}
                      </div>
                      {ret.refund_method ? (
                        <div className="mt-0.5 font-mono text-[9px] text-muted-foreground/60">
                          {REFUND_METHOD_LABELS[ret.refund_method as RefundMethod] ?? ret.refund_method}
                          {ret.refund_reference ? ` · ${ret.refund_reference}` : ""}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Return items detail */}
                  <div className="space-y-0.5 border-t border-signal-700/20 pt-2">
                    {ret.items.map((ri) => {
                      const saleItem = sale.items.find((si) => si.id === ri.sale_item_id);
                      const name     = saleItem?.product_name ?? "—";
                      const unit     = saleItem?.presentation_label ?? saleItem?.product_unit ?? "";
                      return (
                        <div key={ri.sale_item_id} className="flex items-baseline justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                            {name}
                            {!ri.restock && (
                              <span className="rounded-sm border border-red-500/30 bg-red-500/5 px-1 py-0.5 font-mono text-[8px] uppercase text-red-400">
                                No reingresa
                              </span>
                            )}
                          </span>
                          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                            {ri.quantity_returned} {unit} · {moneyFmt.format(ri.line_refund)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* ── Right column: totals + meta ─────────────────────── */}
        <div className="space-y-4">
          {/* Totals */}
          <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-3 space-y-1.5">
            <SectionTitle>Totales</SectionTitle>
            <MetaRow label="Subtotal (neto)" value={moneyFmt.format(sale.subtotal)} />
            <MetaRow label="IVA 15%" value={moneyFmt.format(sale.tax_total)} />
            {sale.discount_total > 0 ? (
              <MetaRow label="Descuentos" value={`−${moneyFmt.format(sale.discount_total)}`} />
            ) : null}
            <div className="border-t border-steel-800/60 pt-1.5">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-foreground">Total</span>
                <span className="font-display text-[22px] leading-none text-safety-500">
                  {moneyFmt.format(sale.total)}
                </span>
              </div>
            </div>
            {totalRefunded > 0 ? (
              <div className="border-t border-steel-800/60 pt-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-signal-400/80">Reembolsado</span>
                  <span className="font-mono text-[14px] font-bold tabular-nums text-signal-400">
                    −{moneyFmt.format(totalRefunded)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Payments */}
          <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-3 space-y-2">
            <SectionTitle>Pagos</SectionTitle>
            {sale.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-[11px] text-foreground">
                    {METHOD_LABELS[p.payment_method] ?? p.payment_method}
                  </span>
                  {p.reference ? (
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/60">
                      {p.reference}
                    </span>
                  ) : null}
                </div>
                <span className="font-mono font-bold tabular-nums text-foreground">
                  {moneyFmt.format(p.amount)}
                </span>
              </div>
            ))}
          </div>

          {/* Customer + meta */}
          <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-3 space-y-1.5">
            <SectionTitle>Información</SectionTitle>
            {sale.customer ? (
              <>
                <MetaRow label="Cliente" value={sale.customer.full_name} />
                <MetaRow label="Doc." value={`${sale.customer.document_type} ${sale.customer.document_number}`} />
                {sale.customer.phone ? (
                  <MetaRow label="Teléfono" value={sale.customer.phone} />
                ) : null}
              </>
            ) : null}
            {sale.warehouse ? (
              <MetaRow label="Bodega" value={sale.warehouse.name} />
            ) : null}
            <MetaRow label="Documento" value={sale.document_kind === "ticket" ? "Ticket" : "Factura"} />
            {sale.notes ? (
              <MetaRow label="Notas" value={sale.notes} />
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────── */}
      <VoidDialog
        saleId={sale.id}
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        onSuccess={() => { setVoidOpen(false); router.refresh(); }}
      />
      <ReturnDialog
        saleId={sale.id}
        items={sale.items}
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        onSuccess={() => { setReturnOpen(false); router.refresh(); }}
        canSetNoRestock={canSetNoRestock}
        cashSessionId={cashSessionId}
      />
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60 pb-1">
      {children}
    </h2>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/70">{label}</span>
      <span className="text-right text-[12px] text-foreground">{value}</span>
    </div>
  );
}

function StatusChip({
  status,
  returnStatus,
}: {
  status:       string;
  returnStatus: "none" | "partial" | "full";
}) {
  if (status === "cancelled") {
    return (
      <span className="rounded-sm border border-red-500/30 bg-red-500/5 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-red-400">
        Anulada
      </span>
    );
  }
  if (returnStatus === "full") {
    return (
      <span className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-signal-400">
        Devuelta
      </span>
    );
  }
  if (returnStatus === "partial") {
    return (
      <span className="rounded-sm border border-signal-600/30 bg-signal-700/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-signal-400/80">
        Dev. parcial
      </span>
    );
  }
  return (
    <span className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-signal-400">
      Confirmada
    </span>
  );
}
