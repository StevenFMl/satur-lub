"use client";

import * as React from "react";
import Big from "big.js";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { createSaleAction } from "@/actions/sales";
import { type PriceOverrideType } from "@/lib/validations/sale";

type PaymentMethod = "cash" | "card" | "transfer";
type CheckoutMode  = "normal" | "credit";

type CartItem = {
  product_id:            string;
  name:                  string;
  unit_price:            number;
  unit_label:            string;
  quantity:              number;
  discount_amount:       number;
  presentation_id:       string | null | undefined;
  base_qty:              number;
  override_unit_price:   number | undefined;
  price_override_type:   string | undefined;
  price_override_reason: string | undefined;
  price_override_note:   string | undefined;
  // Cost data for below-cost detection
  average_cost: number;   // CPP o 0 si no aplica
  has_tax:      boolean;
  tax_rate:     number;
};

type Props = {
  open:           boolean;
  onClose:        () => void;
  cart:           CartItem[];
  totals:         { gross: number; net: number; iva: number };
  customerId:     string;
  warehouseId:    string | null;
  cashSessionId:  string | null;
  onSuccess:      () => void;
  initialMode?:   CheckoutMode;
};

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const today = () => new Date().toISOString().slice(0, 10);

const METHODS: { method: PaymentMethod; label: string }[] = [
  { method: "cash",     label: "Efectivo"     },
  { method: "card",     label: "Tarjeta"      },
  { method: "transfer", label: "Transferencia" },
];

export function CheckoutDialog({
  open, onClose, cart, totals, customerId, warehouseId, cashSessionId, onSuccess,
  initialMode,
}: Props) {
  const [mode, setMode]                   = React.useState<CheckoutMode>(initialMode ?? "normal");
  const [method, setMethod]               = React.useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived]   = React.useState("");
  const [reference, setReference]         = React.useState("");
  const [saleDate, setSaleDate]           = React.useState(today());
  const [isHistorical, setIsHistorical]   = React.useState(false);
  // Fiado
  const [initialPayment, setInitialPayment] = React.useState("");
  const [creditMethod, setCreditMethod]     = React.useState<PaymentMethod>("cash");
  const [creditRef, setCreditRef]           = React.useState("");
  const [dueDate, setDueDate]               = React.useState("");
  const [creditNotes, setCreditNotes]       = React.useState("");

  const [submitting, setSubmitting]           = React.useState(false);
  const [error, setError]                     = React.useState<string | null>(null);
  const [confirmed, setConfirmed]             = React.useState(false);
  const [saleId, setSaleId]                   = React.useState<string | null>(null);
  const [belowCostAcknowledged, setBelowCostAcknowledged] = React.useState(false);

  // ── Below-cost detection ─────────────────────────────────────────────────
  type BelowCostItem = CartItem & { net_price: number; loss_per_unit: number; total_loss: number };
  const belowCostItems = React.useMemo<BelowCostItem[]>(() =>
    cart.flatMap((item) => {
      if (item.average_cost <= 0) return [];
      const gross    = item.override_unit_price ?? item.unit_price;
      const netPrice = item.has_tax && item.tax_rate > 0
        ? gross / (1 + item.tax_rate / 100)
        : gross;
      const lossPerUnit = item.average_cost - netPrice;
      if (lossPerUnit <= 0.001) return [];
      return [{ ...item, net_price: netPrice, loss_per_unit: lossPerUnit, total_loss: lossPerUnit * item.quantity }];
    }),
    [cart]
  );

  const belowCostTotalLoss = React.useMemo(
    () => belowCostItems.reduce((s, i) => s + i.total_loss, 0),
    [belowCostItems]
  );

  const hasBelowCost = belowCostItems.length > 0;

  React.useEffect(() => {
    if (open) {
      setMode(initialMode ?? "normal"); setMethod("cash"); setCashReceived(""); setReference("");
      setSaleDate(today()); setIsHistorical(false); setError(null);
      setConfirmed(false); setSaleId(null); setSubmitting(false);
      setInitialPayment(""); setCreditMethod("cash"); setCreditRef("");
      setDueDate(""); setCreditNotes("");
      setBelowCostAcknowledged(false);
    }
  }, [open, initialMode]);

  const gross = totals.gross;

  const isZeroTotal = gross < 0.01;

  const cashReceivedNum = React.useMemo(() => {
    const n = parseFloat(cashReceived.replace(",", "."));
    return isFinite(n) ? n : 0;
  }, [cashReceived]);

  const change = React.useMemo(() => {
    if (mode !== "normal" || method !== "cash") return null;
    const c = Big(cashReceivedNum).minus(Big(gross));
    return c.gte(0) ? Number(c.round(2).toString()) : null;
  }, [cashReceivedNum, gross, method, mode]);

  const cashValid = mode === "credit" || method !== "cash" || cashReceivedNum >= gross - 0.001;

  // Fiado calcs
  const initialPaymentNum = React.useMemo(() => {
    const n = parseFloat(initialPayment.replace(",", "."));
    return isFinite(n) && n >= 0 ? n : 0;
  }, [initialPayment]);

  const creditBalance = React.useMemo(
    () => Number(Big(gross).minus(initialPaymentNum).round(2).toString()),
    [gross, initialPaymentNum]
  );

  const creditValid = React.useMemo(() => {
    if (initialPaymentNum > gross + 0.001) return false;
    if (initialPaymentNum > 0 && !creditMethod) return false;
    return true;
  }, [initialPaymentNum, gross, creditMethod]);

  const handleConfirm = async () => {
    setSubmitting(true); setError(null);

    const basePayload = {
      customer_id:   customerId,
      warehouse_id:  warehouseId,
      items: cart.map((l) => ({
        product_id:            l.product_id,
        quantity:              l.quantity,
        discount_amount:       l.discount_amount,
        presentation_id:       l.presentation_id ?? undefined,
        base_qty:              l.base_qty,
        override_unit_price:   l.override_unit_price   ?? undefined,
        price_override_type:   (l.price_override_type as PriceOverrideType | undefined) ?? undefined,
        price_override_reason: l.price_override_reason ?? undefined,
        price_override_note:   l.price_override_note   ?? undefined,
      })),
      document_kind: "ticket" as const,
      sale_date:     isHistorical ? saleDate : null,
    };

    // Zero-total (courtesy): RPC accepts payments:[] when total=0
    if (isZeroTotal) {
      const result = await createSaleAction(
        { ...basePayload, payments: [], is_credit: false },
        cashSessionId,
        hasBelowCost && belowCostAcknowledged,
        belowCostTotalLoss
      );
      setSubmitting(false);
      if (result?.error) { setError(result.error); return; }
      setSaleId(result?.saleId ?? null);
      setConfirmed(true);
      return;
    }

    if (mode === "normal" && !cashValid) {
      setSubmitting(false);
      setError("El monto recibido es menor al total."); return;
    }
    if (mode === "credit" && !creditValid) {
      setSubmitting(false);
      setError("El pago inicial no puede superar el total de la venta."); return;
    }

    const isBelowCost = hasBelowCost && belowCostAcknowledged;
    const result = mode === "credit"
      ? await createSaleAction({
          ...basePayload,
          payments:               [],
          is_credit:              true,
          initial_payment:        initialPaymentNum,
          initial_payment_method: initialPaymentNum > 0 ? creditMethod : null,
          initial_payment_ref:    creditRef || null,
          due_date:               dueDate || null,
          credit_notes:           creditNotes || null,
        }, cashSessionId, isBelowCost, belowCostTotalLoss)
      : await createSaleAction({
          ...basePayload,
          payments: [{ method, amount: method === "cash" ? Math.max(cashReceivedNum, gross) : gross, reference: reference || undefined }],
          is_credit: false,
        }, cashSessionId, isBelowCost, belowCostTotalLoss);

    setSubmitting(false);
    if (result?.error) { setError(result.error); return; }
    setSaleId(result?.saleId ?? null);
    setConfirmed(true);
  };

  const handleClose = () => { if (confirmed) onSuccess(); onClose(); };

  // ── Success / Receipt screen ────────────────────────────────────────────
  if (confirmed) {
    const receiptDate = new Date().toLocaleDateString("es-EC", { day: "2-digit", month: "long", year: "numeric" });

    return (
      <Dialog open={open} onClose={handleClose} title="" description="">
        {/* Receipt body — scrollable */}
        <div className="max-h-[75vh] overflow-y-auto">
          {/* Receipt header */}
          <div className="border-b-2 border-dashed border-steel-700 px-6 py-4 text-center">
            <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full border border-signal-500/50 bg-signal-500/10">
              <CheckCircleIcon className="h-5 w-5 text-signal-500" />
            </div>
            <p className="font-display text-[16px] font-bold tracking-[0.04em] text-foreground">
              {mode === "credit" ? "VENTA FIADA" : "COMPROBANTE DE VENTA"}
            </p>
            {saleId ? (
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                # {saleId.slice(0, 8).toUpperCase()}
              </p>
            ) : null}
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{receiptDate}</p>
          </div>

          {/* Line items */}
          {cart.length > 0 ? (
            <div className="border-b border-dashed border-steel-700 px-6 py-3">
              <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
                Productos
              </p>
              <div className="space-y-2">
                {cart.map((item, i) => {
                  const effectivePrice = item.override_unit_price ?? item.unit_price;
                  const lineTotal = effectivePrice * item.quantity;
                  const isCombo = item.price_override_type === "combo";
                  const isCourt = item.price_override_type === "courtesy";
                  const hasDiscount = item.override_unit_price != null && item.override_unit_price < item.unit_price;
                  return (
                    <div key={i} className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-semibold text-foreground">{item.name}</span>
                          {isCombo ? (
                            <span className="rounded-sm border border-emerald-700/40 bg-emerald-900/20 px-1 font-mono text-[8px] font-bold uppercase text-emerald-400">COMBO</span>
                          ) : isCourt ? (
                            <span className="rounded-sm border border-safety-500/30 bg-safety-500/10 px-1 font-mono text-[8px] font-bold uppercase text-safety-500">CORT.</span>
                          ) : hasDiscount ? (
                            <span className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-1 font-mono text-[8px] font-bold uppercase text-signal-400">DESC.</span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                          {item.quantity} {item.unit_label} × {moneyFmt.format(effectivePrice)}
                          {hasDiscount ? (
                            <span className="ml-1 line-through text-muted-foreground/40">{moneyFmt.format(item.unit_price)}</span>
                          ) : null}
                        </p>
                        {item.price_override_reason ? (
                          <p className="font-mono text-[9px] italic text-muted-foreground/50">{item.price_override_reason}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 font-mono text-[12px] font-bold tabular-nums text-foreground">
                        {moneyFmt.format(lineTotal)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Totals */}
          <div className="border-b border-dashed border-steel-700 px-6 py-3 space-y-1.5">
            <SummaryRow label="Subtotal (s/IVA)" value={moneyFmt.format(totals.net)} />
            <SummaryRow label="IVA (15%)"         value={moneyFmt.format(totals.iva)} />
            <div className="my-1 h-px border-t border-dashed border-steel-700" />
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-foreground">TOTAL</span>
              <span className="font-display text-[22px] leading-none tracking-[0.02em] text-safety-500">
                {moneyFmt.format(gross)}
              </span>
            </div>
          </div>

          {/* Payment / credit info */}
          <div className="px-6 py-3 space-y-1.5">
            {mode === "credit" ? (
              <>
                <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-safety-400/70">Condiciones de crédito</p>
                <SummaryRow label="Abono inicial"   value={moneyFmt.format(initialPaymentNum)} />
                <SummaryRow label="Saldo pendiente" value={moneyFmt.format(creditBalance)} bold />
                {dueDate ? <SummaryRow label="Vencimiento" value={dueDate} /> : null}
              </>
            ) : (
              <>
                {method === "cash" && change !== null && change > 0 ? (
                  <SummaryRow label="Cambio entregado" value={moneyFmt.format(change)} />
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex gap-2.5 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-sm border border-steel-700 bg-steel-900 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
          >
            <PrinterIcon className="h-3.5 w-3.5" />
            Imprimir
          </button>
          <Button size="md" className="flex-1" onClick={handleClose}>
            Nueva venta
          </Button>
        </div>
      </Dialog>
    );
  }

  // ── Below-cost confirmation step ─────────────────────────────────────────
  if (hasBelowCost && !belowCostAcknowledged) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Precio bajo costo"
        description=""
      >
        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-6 py-5">
          {/* Warning header */}
          <div className="flex items-start gap-3 rounded-sm border border-signal-600/40 bg-signal-700/10 px-4 py-3">
            <WarningIcon className="mt-0.5 h-5 w-5 shrink-0 text-signal-400" />
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-signal-400">
                {belowCostItems.length === 1 ? "1 ítem" : `${belowCostItems.length} ítems`} por debajo del costo estimado
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] leading-5 text-signal-400/70">
                El precio de venta neto (s/IVA) es inferior al costo promedio del producto.
                Confirma sólo si es intencional.
              </p>
            </div>
          </div>

          {/* Affected items table */}
          <div className="overflow-x-auto rounded-sm border border-steel-700">
            <table className="w-full min-w-[380px] text-left">
              <thead className="border-b border-steel-700 bg-steel-950/50">
                <tr>
                  <th className="px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">Producto</th>
                  <th className="px-3 py-2 text-right font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">Precio neto</th>
                  <th className="px-3 py-2 text-right font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">CPP</th>
                  <th className="px-3 py-2 text-right font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-red-400/70">Pérdida est.</th>
                </tr>
              </thead>
              <tbody>
                {belowCostItems.map((item, idx) => (
                  <tr key={idx} className="border-b border-steel-800/40 last:border-0">
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-[12px] text-foreground">{item.name}</div>
                      <div className="font-mono text-[9.5px] text-muted-foreground/60">
                        {item.quantity} {item.unit_label}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                      {moneyFmt.format(item.net_price)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums text-muted-foreground/70">
                      {moneyFmt.format(item.average_cost)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[13px] font-bold tabular-nums text-red-400">
                      −{moneyFmt.format(item.total_loss)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Total loss summary */}
          <div className="flex items-baseline justify-between rounded-sm border border-red-500/30 bg-red-500/5 px-4 py-2.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-red-400/80">
              Pérdida total estimada
            </span>
            <span className="font-mono text-[16px] font-bold tabular-nums text-red-400">
              −{moneyFmt.format(belowCostTotalLoss)}
            </span>
          </div>

          {/* Disclaimer */}
          <p className="font-mono text-[9.5px] leading-4 text-muted-foreground/45">
            Estimación basada en el CPP actual del producto. No incluye costos indirectos.
            Esta confirmación quedará registrada en el historial de la venta.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button variant="outline" size="md" onClick={onClose}>
            Cancelar
          </Button>
          <button
            type="button"
            onClick={() => setBelowCostAcknowledged(true)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border-2 border-signal-600/60 bg-signal-700/15 px-4 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-signal-400 transition-colors hover:bg-signal-700/25"
          >
            <WarningIcon className="h-3.5 w-3.5" />
            Entendido — continuar
          </button>
        </div>
      </Dialog>
    );
  }

  // ── Form ────────────────────────────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onClose={!submitting ? onClose : () => {}}
      title="Cobro"
      description={`Total: ${moneyFmt.format(gross)}`}
    >
      <div className="space-y-4 px-6 py-5">
        {/* Total highlight */}
        <div className="flex items-baseline justify-between rounded-sm border-2 border-safety-500/40 bg-safety-500/5 px-4 py-2.5">
          <span className="font-mono text-[11.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Total
          </span>
          <span className="font-display text-[26px] leading-none text-safety-500">
            {moneyFmt.format(gross)}
          </span>
        </div>

        {/* IVA breakdown */}
        <div className="space-y-1 text-[12px]">
          <SummaryRow label="Subtotal (neto)" value={moneyFmt.format(totals.net)} />
          <SummaryRow label="IVA"             value={moneyFmt.format(totals.iva)} />
        </div>

        {/* ── Cortesía / venta gratis ─────────────────────────────────── */}
        {isZeroTotal ? (
          <div className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-4 py-3 space-y-1">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-signal-400">
              ★ Venta cortesía — $0.00
            </p>
            <p className="font-mono text-[10.5px] text-signal-400/70">
              Sin método de pago. La venta queda registrada con trazabilidad completa.
            </p>
          </div>
        ) : (
          <>
            {/* Mode toggle: Normal / Fiado */}
            <div className="grid grid-cols-2 gap-2 rounded-sm border border-steel-700 p-1">
              <ModeBtn active={mode === "normal"} onClick={() => { setMode("normal"); setError(null); }}>
                <CashIcon className="h-4 w-4" /> Cobro normal
              </ModeBtn>
              <ModeBtn active={mode === "credit"} onClick={() => { setMode("credit"); setError(null); }}>
                <CreditIcon className="h-4 w-4" /> Fiado
              </ModeBtn>
            </div>

                {/* ── Modo NORMAL ─────────────────────────────────────────── */}
            {mode === "normal" ? (
              <>
                <div className="space-y-1.5">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    Método de pago
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {METHODS.map(({ method: m, label }) => (
                      <button
                        key={m} type="button"
                        onClick={() => { setMethod(m); setError(null); }}
                        className={[
                          "flex flex-col items-center gap-1.5 rounded-sm border-2 px-2 py-2.5 transition-all",
                          method === m
                            ? "border-safety-500 bg-safety-500/10 text-safety-500 shadow-safety-glow"
                            : "border-steel-700 bg-steel-900 text-muted-foreground hover:border-steel-600 hover:text-foreground",
                        ].join(" ")}
                      >
                        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em]">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {method === "cash" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="cash-received">Monto recibido</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        USD
                      </span>
                      <Input
                        id="cash-received" type="number" min={0} step="0.01"
                        value={cashReceived}
                        onChange={(e) => { setCashReceived(e.target.value); setError(null); }}
                        placeholder={String(gross.toFixed(2))}
                        mono className="h-11 pl-14 text-right text-[15px]"
                        onFocus={(e) => e.target.select()} autoFocus
                      />
                    </div>
                    {change !== null && change >= 0 ? (
                      <div className="flex items-baseline justify-between rounded-sm border border-signal-600/30 bg-signal-700/15 px-3 py-2">
                        <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-signal-400">Cambio</span>
                        <span className="font-mono text-[15px] font-bold tabular-nums text-signal-400">{moneyFmt.format(change)}</span>
                      </div>
                    ) : cashReceived && !cashValid ? (
                      <p className="font-mono text-[11px] text-red-400">Faltan {moneyFmt.format(gross - cashReceivedNum)}</p>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="reference">
                      Referencia <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opcional)</span>
                    </Label>
                    <Input
                      id="reference" value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder={method === "card" ? "Últimos 4 dígitos" : "N.° transferencia"}
                      maxLength={60} autoFocus
                    />
                  </div>
                )}
              </>
            ) : (
              /* ── Modo FIADO ──────────────────────────────────────────── */
              <div className="space-y-3">
                <div className="rounded-sm border border-safety-500/20 bg-safety-500/5 px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-safety-400/80">
                    La venta se registra normalmente. El cliente puede abonar después.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="initial-payment">
                    Pago inicial <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(0 para fiado total)</span>
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      USD
                    </span>
                    <Input
                      id="initial-payment" type="number" min={0} step="0.01"
                      max={gross}
                      value={initialPayment}
                      onChange={(e) => { setInitialPayment(e.target.value); setError(null); }}
                      placeholder="0.00"
                      mono className="h-11 pl-14 text-right text-[15px]"
                      onFocus={(e) => e.target.select()} autoFocus
                    />
                  </div>
                </div>

                <div className="flex items-baseline justify-between rounded-sm border-2 border-signal-600/40 bg-signal-700/10 px-4 py-2.5">
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal-400">Saldo a fiar</span>
                  <span className="font-mono text-[18px] font-bold tabular-nums text-signal-400">{moneyFmt.format(creditBalance)}</span>
                </div>

                {initialPaymentNum > 0 ? (
                  <div className="space-y-1.5">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                      Método del pago inicial
                    </Label>
                    <div className="grid grid-cols-3 gap-2">
                      {METHODS.map(({ method: m, label }) => (
                        <button
                          key={m} type="button"
                          onClick={() => setCreditMethod(m)}
                          className={[
                            "rounded-sm border-2 px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-all",
                            creditMethod === m
                              ? "border-safety-500 bg-safety-500/10 text-safety-500"
                              : "border-steel-700 bg-steel-900 text-muted-foreground hover:border-steel-600",
                          ].join(" ")}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <Input
                      value={creditRef}
                      onChange={(e) => setCreditRef(e.target.value)}
                      placeholder={creditMethod === "card" ? "Últimos 4 dígitos" : creditMethod === "transfer" ? "N.° transferencia" : "Referencia (opcional)"}
                      maxLength={60}
                    />
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="due-date">
                    Vencimiento <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opcional)</span>
                  </Label>
                  <Input id="due-date" type="date" value={dueDate} mono className="h-10"
                    min={today()} onChange={(e) => setDueDate(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="credit-notes">
                    Nota <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opcional)</span>
                  </Label>
                  <Input id="credit-notes" value={creditNotes}
                    onChange={(e) => setCreditNotes(e.target.value)}
                    placeholder="Ej: Cliente de confianza, paga fin de mes"
                    maxLength={200} />
                </div>
              </div>
            )}
          </>
        )}

        {/* Historical date */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setIsHistorical((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <ChevronIcon className={"h-3 w-3 transition-transform " + (isHistorical ? "rotate-90" : "")} />
            Registrar con fecha diferente (venta histórica)
          </button>
          {isHistorical ? (
            <Input type="date" value={saleDate} max={today()}
              onChange={(e) => setSaleDate(e.target.value)}
              mono className="h-10" aria-label="Fecha de venta"
            />
          ) : null}
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>

      <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
        <Button variant="outline" size="md" onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button
          size="md" loading={submitting}
          disabled={submitting || (!isZeroTotal && (mode === "normal" ? !cashValid : !creditValid))}
          onClick={handleConfirm}
          className="min-w-[130px]"
        >
          {isZeroTotal ? "Confirmar cortesía" : mode === "credit" ? "Registrar fiado" : "Confirmar cobro"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={"font-mono uppercase tracking-[0.1em] " + (bold ? "text-[12px] font-bold text-foreground" : "text-[11px] text-muted-foreground/70")}>
        {label}
      </span>
      {value ? (
        <span className={"font-mono tabular-nums " + (bold ? "text-[13.5px] font-bold text-foreground" : "text-[12px] text-muted-foreground")}>
          {value}
        </span>
      ) : null}
    </div>
  );
}

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" onClick={onClick}
      className={[
        "flex items-center justify-center gap-1.5 rounded-sm px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] transition-all",
        active
          ? "bg-safety-500 text-steel-950"
          : "text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ── Icons ───────────────────────────────────────────────────────────────────

function CashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function CreditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function PrinterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
