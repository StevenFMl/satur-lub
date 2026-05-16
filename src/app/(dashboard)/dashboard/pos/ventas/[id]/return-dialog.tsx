"use client";

import * as React from "react";
import Big from "big.js";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { createSaleReturnAction } from "@/actions/sales";
import {
  REFUND_METHODS,
  REFUND_METHOD_LABELS,
  type RefundMethod,
} from "@/lib/validations/sale-return";
import type { SaleDetailItem } from "./page";

// ── Money helpers ──────────────────────────────────────────────────────────

/**
 * Proportional line refund using the same formula as the RPC:
 *   full return  → line_total exactly (no rounding drift)
 *   partial      → ROUND(line_total / quantity * qty_ret, 2, HALF_UP)
 *
 * Uses line_total (what was actually charged, after discount + override),
 * NOT quantity * unit_price. Big.roundHalfUp matches PostgreSQL ROUND numeric.
 */
function lineRefundBig(lineTotal: number, quantity: number, qtyReturned: number): Big {
  if (quantity <= 0) return Big(0);
  const total = Big(lineTotal);
  if (Big(qtyReturned).gte(Big(quantity))) return total;
  return total
    .div(Big(quantity))
    .times(Big(qtyReturned))
    .round(2, Big.roundHalfUp);
}

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  saleId:          string;
  items:           SaleDetailItem[];
  open:            boolean;
  onClose:         () => void;
  onSuccess:       (returnId: string, refundAmount: number, isExchange: boolean) => void;
  canSetNoRestock: boolean;
  cashSessionId:   string | null;
};

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

// ── Component ──────────────────────────────────────────────────────────────

export function ReturnDialog({
  saleId,
  items,
  open,
  onClose,
  onSuccess,
  canSetNoRestock,
  cashSessionId,
}: Props) {
  // Only items that still have quantity available to return
  const returnableItems = React.useMemo(
    () => items.filter((i) => i.available_to_return > 0),
    [items]
  );

  // qty to return per sale_item_id (0 = not included)
  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  // restock per sale_item_id
  const [restockMap, setRestockMap]   = React.useState<Record<string, boolean>>({});
  const [reason,        setReason]        = React.useState("");
  const [refundMethod,  setRefundMethod]  = React.useState<RefundMethod | "">("");
  const [refundRef,     setRefundRef]     = React.useState("");
  const [isExchange,    setIsExchange]    = React.useState(false);
  const [loading,       setLoading]       = React.useState(false);
  const [error,         setError]         = React.useState<string | null>(null);

  // Reset on open
  React.useEffect(() => {
    if (open) {
      setQuantities({});
      setRestockMap({});
      setReason("");
      setRefundMethod("");
      setRefundRef("");
      setIsExchange(false);
      setLoading(false);
      setError(null);
    }
  }, [open]);

  // ── Derived ───────────────────────────────────────────────────
  const selectedItems = React.useMemo(
    () =>
      returnableItems
        .filter((i) => (quantities[i.id] ?? 0) > 0)
        .map((i) => ({
          item: i,
          qty:  quantities[i.id]!,
          restock: restockMap[i.id] ?? true,
        })),
    [returnableItems, quantities, restockMap]
  );

  // Uses proportional formula matching the RPC: lineRefundBig(line_total, quantity, qty).
  const totalRefund: Big = React.useMemo(
    () =>
      selectedItems.reduce(
        (sum, { item, qty }) =>
          sum.plus(lineRefundBig(item.line_total, item.quantity, qty)),
        Big(0)
      ).round(2, Big.roundHalfUp),
    [selectedItems]
  );

  const canSubmit =
    selectedItems.length > 0 &&
    reason.trim().length >= 3 &&
    !loading;

  // ── Handlers ──────────────────────────────────────────────────
  function setQty(itemId: string, raw: string, max: number) {
    const val = parseFloat(raw);
    if (raw === "" || isNaN(val)) {
      setQuantities((p) => ({ ...p, [itemId]: 0 }));
      return;
    }
    const clamped = Math.min(Math.max(0, val), max);
    setQuantities((p) => ({ ...p, [itemId]: clamped }));
    setError(null);
  }

  function toggleItem(itemId: string, max: number) {
    setQuantities((p) => {
      const current = p[itemId] ?? 0;
      return { ...p, [itemId]: current > 0 ? 0 : max };
    });
    setError(null);
  }

  function toggleRestock(itemId: string) {
    setRestockMap((p) => ({ ...p, [itemId]: !(p[itemId] ?? true) }));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const result = await createSaleReturnAction(
      {
        sale_id: saleId,
        items: selectedItems.map(({ item, qty, restock }) => ({
          sale_item_id:      item.id,
          quantity_returned: qty,
          restock,
        })),
        reason:           reason.trim(),
        notes:            null,
        refund_amount:    Number(totalRefund.toFixed(2)),
        refund_method:    refundMethod || null,
        refund_reference: refundRef.trim() || null,
      },
      cashSessionId     // propagates to RPC → cash_out movement when method = 'cash'
    );

    setLoading(false);

    if (result?.error) {
      setError(result.error);
      return;
    }

    onSuccess(result?.returnId ?? "", Number(totalRefund.toFixed(2)), isExchange);
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onClose={!loading ? onClose : () => {}}
      title="Registrar devolución"
      description="Selecciona los ítems y cantidades a devolver."
      className="max-w-xl"
    >
        {/* Body — Dialog wraps children in max-h-[70vh] overflow-y-auto */}
        <div className="space-y-6 px-6 py-5">

          {/* ── Items ───────────────────────────────────────── */}
          <div className="space-y-2">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
              Ítems
            </p>

            {returnableItems.length === 0 ? (
              <p className="rounded-sm border border-steel-700 px-4 py-3 font-mono text-[11.5px] text-muted-foreground">
                Todos los ítems ya han sido devueltos.
              </p>
            ) : (
              <div className="space-y-2">
                {returnableItems.map((item) => {
                  const unitLabel = item.presentation_label ?? item.product_unit;
                  const qty       = quantities[item.id] ?? 0;
                  const isSelected = qty > 0;
                  const restock   = restockMap[item.id] ?? true;

                  return (
                    <div
                      key={item.id}
                      className={[
                        "rounded-sm border p-3 transition-colors",
                        isSelected
                          ? "border-safety-500/40 bg-safety-500/5"
                          : "border-steel-700 bg-steel-900/40",
                      ].join(" ")}
                    >
                      {/* Row 1: checkbox + name + totals */}
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          id={`item-toggle-${item.id}`}
                          onClick={() => toggleItem(item.id, item.available_to_return)}
                          className={[
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-2 transition-colors",
                            isSelected
                              ? "border-safety-500 bg-safety-500 text-steel-950"
                              : "border-steel-600 bg-transparent",
                          ].join(" ")}
                          aria-label={`${isSelected ? "Deseleccionar" : "Seleccionar"} ${item.product_name}`}
                        >
                          {isSelected && (
                            <svg viewBox="0 0 10 8" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M1 4l3 3L9 1" />
                            </svg>
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-foreground">
                            {item.product_name}
                          </p>
                          {/* Stats row */}
                          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground/70">
                            <span>Vendido: {item.quantity} {unitLabel}</span>
                            {item.already_returned > 0 && (
                              <span className="text-signal-400/80">
                                Devuelto: {item.already_returned}
                              </span>
                            )}
                            <span className="text-foreground/60">
                              Disponible: <strong>{item.available_to_return}</strong>
                            </span>
                          </div>
                        </div>

                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
                          {moneyFmt.format(item.unit_price)}/{unitLabel}
                        </span>
                      </div>

                      {/* Row 2: qty input + restock toggle (only when selected) */}
                      {isSelected && (
                        <div className="mt-3 flex items-center gap-3 border-t border-steel-700/50 pt-3">
                          {/* Quantity */}
                          <div className="flex items-center gap-2">
                            <label
                              htmlFor={`qty-${item.id}`}
                              className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60"
                            >
                              Cant.
                            </label>
                            <input
                              id={`qty-${item.id}`}
                              type="number"
                              min={0.001}
                              max={item.available_to_return}
                              step="any"
                              value={qty === 0 ? "" : qty}
                              onChange={(e) => setQty(item.id, e.target.value, item.available_to_return)}
                              className="w-24 rounded-sm border border-steel-600 bg-steel-950 px-2.5 py-1.5 text-right font-mono text-[12px] text-foreground focus:border-safety-500 focus:outline-none focus:ring-1 focus:ring-safety-500/40"
                            />
                            <span className="font-mono text-[10px] text-muted-foreground/60">
                              {unitLabel}
                            </span>
                          </div>

                          <div className="flex-1" />

                          {/* Restock toggle */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              id={`restock-${item.id}`}
                              disabled={!canSetNoRestock}
                              onClick={() => toggleRestock(item.id)}
                              className={[
                                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors",
                                restock
                                  ? "border-safety-500 bg-safety-500"
                                  : "border-steel-600 bg-steel-700",
                                !canSetNoRestock ? "cursor-not-allowed opacity-50" : "",
                              ].join(" ")}
                              aria-label="Reingresar al stock"
                              title={canSetNoRestock ? undefined : "Solo admin puede desactivar el reingreso"}
                            >
                              <span
                                className={[
                                  "inline-block h-3.5 w-3.5 translate-y-[-0.5px] rounded-full bg-white shadow transition-transform",
                                  restock ? "translate-x-3.5" : "translate-x-0.5",
                                ].join(" ")}
                              />
                            </button>
                            <label
                              htmlFor={`restock-${item.id}`}
                              className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/60"
                            >
                              {restock ? "Reingresa stock" : "No reingresa"}
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Line refund preview */}
                      {isSelected && (
                        <div className="mt-1.5 flex justify-end">
                          <span className="font-mono text-[10.5px] font-semibold tabular-nums text-safety-500">
                            −{moneyFmt.format(Number(lineRefundBig(item.line_total, item.quantity, qty).toFixed(2)))}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Reason ──────────────────────────────────────── */}
          <div className="space-y-1.5">
            <Label htmlFor="return-reason">
              Motivo de devolución{" "}
              <span className="font-normal text-red-400">*</span>
            </Label>
            <Input
              id="return-reason"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(null); }}
              placeholder="Ej: Producto dañado, presentación incorrecta..."
              maxLength={300}
              autoComplete="off"
            />
            <p className="font-mono text-[10px] text-muted-foreground/50">
              {reason.length}/300
            </p>
          </div>

          {/* ── Refund method ────────────────────────────────── */}
          <div className="space-y-3">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
              Reembolso
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="refund-method">Método de reembolso</Label>
              <Select
                id="refund-method"
                value={refundMethod}
                onChange={(e) => setRefundMethod(e.target.value as RefundMethod | "")}
              >
                <option value="">— Sin reembolso inmediato —</option>
                {REFUND_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {REFUND_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </div>

            {refundMethod === "transfer" && (
              <div className="space-y-1.5">
                <Label htmlFor="refund-ref">Referencia / No. de transferencia</Label>
                <Input
                  id="refund-ref"
                  value={refundRef}
                  onChange={(e) => setRefundRef(e.target.value)}
                  placeholder="Ej: TXN-20240511-001"
                  maxLength={120}
                />
              </div>
            )}

            {/* Cash session status — only relevant when refund method is cash */}
            {refundMethod === "cash" && (
              cashSessionId ? (
                <div className="flex items-center gap-2 rounded-sm border border-signal-600/30 bg-signal-900/20 px-3 py-2">
                  <CashRegisterIcon className="h-3.5 w-3.5 shrink-0 text-signal-400/70" />
                  <p className="font-mono text-[10px] text-signal-400/80">
                    Sesión de caja abierta — el reembolso se registrará como salida en caja automáticamente.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-sm border border-amber-600/30 bg-amber-900/10 px-3 py-2">
                  <WarningIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/70" />
                  <p className="font-mono text-[10px] text-amber-400/80">
                    Sin sesión de caja abierta — el reembolso no se registrará en caja automáticamente.
                    Registra el egreso manualmente si corresponde.
                  </p>
                </div>
              )
            )}
          </div>

          {/* ── Exchange toggle ──────────────────────────────── */}
          <div className="flex items-start gap-3 rounded-sm border border-steel-700 bg-steel-900/40 px-4 py-3">
            <button
              type="button"
              onClick={() => setIsExchange((v) => !v)}
              className={[
                "relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 transition-colors",
                isExchange
                  ? "border-safety-500 bg-safety-500"
                  : "border-steel-600 bg-steel-700",
              ].join(" ")}
              aria-label="Registrar como cambio"
            >
              <span
                className={[
                  "inline-block h-3.5 w-3.5 translate-y-[-0.5px] rounded-full bg-white shadow transition-transform",
                  isExchange ? "translate-x-3.5" : "translate-x-0.5",
                ].join(" ")}
              />
            </button>
            <div>
              <p className="text-[12.5px] font-semibold text-foreground">
                Es un cambio de producto
              </p>
              <p className="mt-0.5 font-mono text-[10px] leading-4 text-muted-foreground/60">
                {isExchange
                  ? "Se abrirá el POS con el crédito disponible para registrar la nueva venta."
                  : "Al activar esto, podrás registrar la venta de reemplazo directamente en el POS."}
              </p>
            </div>
          </div>

          {/* ── Summary ─────────────────────────────────────── */}
          {selectedItems.length > 0 && (
            <div className="rounded-sm border border-safety-500/20 bg-safety-500/5 px-4 py-3 space-y-1.5">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
                Resumen de devolución
              </p>
              {selectedItems.map(({ item, qty }) => {
                const refund = lineRefundBig(item.line_total, item.quantity, qty);
                const unitLabel = item.presentation_label ?? item.product_unit;
                return (
                  <div key={item.id} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[12px] text-foreground/80">
                      {item.product_name}
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/60">
                        {qty} {unitLabel}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                      {moneyFmt.format(Number(refund.toFixed(2)))}
                    </span>
                  </div>
                );
              })}
              <div className="border-t border-safety-500/20 pt-1.5 flex items-baseline justify-between">
                <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-foreground">
                  Total a reembolsar
                </span>
                <span className="font-display text-[22px] leading-none text-safety-500">
                  {moneyFmt.format(Number(totalRefund.toFixed(2)))}
                </span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && <Alert tone="error">{error}</Alert>}
        </div>

        {/* Footer — sticky inside Dialog's overflow-y-auto scroll container */}
        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900 px-6 py-4">
          <button
            type="button"
            onClick={!loading ? onClose : undefined}
            disabled={loading}
            className="h-10 rounded-sm border border-steel-600 bg-transparent px-4 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-steel-500 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={[
              "inline-flex h-10 items-center justify-center gap-2 rounded-sm border-2 px-5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-all",
              canSubmit
                ? "border-safety-500/70 bg-safety-500/10 text-safety-500 hover:bg-safety-500/20"
                : "cursor-not-allowed border-steel-700 text-muted-foreground/40",
            ].join(" ")}
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <SpinIcon className="h-3.5 w-3.5 animate-spin" />
                Registrando...
              </span>
            ) : isExchange ? (
              <>
                <ArrowReturnIcon className="h-3.5 w-3.5" />
                Registrar y abrir POS
              </>
            ) : (
              <>
                <ArrowReturnIcon className="h-3.5 w-3.5" />
                Confirmar devolución
              </>
            )}
          </button>
        </div>
    </Dialog>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function SpinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function ArrowReturnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function CashRegisterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 7l1-4h14l1 4" />
      <rect x="2" y="7" width="20" height="13" rx="1" />
      <path d="M16 12h.01M12 12h.01M8 12h.01M16 16h.01M12 16h.01M8 16h.01" />
      <path d="M6 7v13" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
