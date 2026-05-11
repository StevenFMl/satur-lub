"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SaleDetailData } from "./page";
import { PRICE_OVERRIDE_LABELS, type PriceOverrideType } from "@/lib/validations/sale";
import { VoidDialog } from "../void-dialog";

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia",
};

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString("es-EC", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-EC", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

export function SaleDetail({
  sale,
  canVoidSale,
}: {
  sale:        SaleDetailData;
  canVoidSale: boolean;
}) {
  const router               = useRouter();
  const [voidOpen, setVoidOpen] = React.useState(false);

  const isCancelled = sale.status === "cancelled";
  const hasOverride = sale.items.some((i) => i.original_unit_price != null);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-[22px] tracking-[0.04em]">VENTA</h1>
            <span className="font-mono text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
              #{sale.id.slice(0, 8).toUpperCase()}
            </span>
            <StatusChip status={sale.status} />
          </div>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {fmtDate(sale.sale_date)} · registrada {fmtDatetime(sale.created_at)}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start">
          <Link
            href="/dashboard/pos/ventas"
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            ← Historial
          </Link>
          {canVoidSale && !isCancelled ? (
            <button
              type="button"
              onClick={() => setVoidOpen(true)}
              className="h-8 rounded-sm border border-red-500/40 bg-red-500/5 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-red-400 transition-colors hover:bg-red-500/10"
            >
              Anular venta
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Cancellation notice ────────────────────────────────── */}
      {isCancelled ? (
        <div className="rounded-sm border border-red-500/30 bg-red-500/5 px-4 py-3 space-y-1">
          <p className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-red-400">
            Venta anulada · {fmtDatetime(sale.cancelled_at ?? "")}
          </p>
          {sale.cancellation_reason ? (
            <p className="text-[12.5px] text-foreground">
              {sale.cancellation_reason}
            </p>
          ) : null}
          {sale.cancellation_note ? (
            <p className="text-[11.5px] text-muted-foreground">{sale.cancellation_note}</p>
          ) : null}
        </div>
      ) : null}

      {/* ── Two-column layout on desktop ──────────────────────── */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_260px]">

        {/* ── Items ─────────────────────────────────────────────── */}
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
                  const unitLabel = item.presentation_label ?? item.product_unit;
                  const hasItemOverride = item.original_unit_price != null;
                  return (
                    <tr key={item.id}>
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
              const unitLabel = item.presentation_label ?? item.product_unit;
              const hasItemOverride = item.original_unit_price != null;
              return (
                <div key={item.id} className="rounded-sm border border-steel-700 bg-steel-900/40 px-3 py-2.5">
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
                    </div>
                    <span className="font-mono font-bold tabular-nums text-foreground">
                      {moneyFmt.format(item.line_total)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Override badge */}
          {hasOverride ? (
            <div className="rounded-sm border border-signal-700/30 bg-signal-900/20 px-3 py-2">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-signal-500/70">
                Esta venta incluyó ajustes de precio
              </p>
            </div>
          ) : null}
        </div>

        {/* ── Right column: totals + meta ───────────────────────── */}
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

      {/* Void dialog */}
      <VoidDialog
        saleId={sale.id}
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        onSuccess={() => { setVoidOpen(false); router.refresh(); }}
      />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

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

function StatusChip({ status }: { status: string }) {
  if (status === "confirmed") {
    return (
      <span className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-signal-400">
        Confirmada
      </span>
    );
  }
  return (
    <span className="rounded-sm border border-red-500/30 bg-red-500/5 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-red-400">
      Anulada
    </span>
  );
}
