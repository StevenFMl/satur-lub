"use client";

import * as React from "react";
import Big from "big.js";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { createSaleAction } from "@/actions/sales";
import { PRICE_OVERRIDE_LABELS, type PriceOverrideType } from "@/lib/validations/sale";

type PaymentMethod = "cash" | "card" | "transfer";
type CheckoutMode  = "normal" | "credit";

type CartItem = {
  product_id:            string;
  quantity:              number;
  discount_amount:       number;
  presentation_id:       string | null | undefined;
  base_qty:              number;
  override_unit_price:   number | undefined;
  price_override_type:   string | undefined;
  price_override_reason: string | undefined;
  price_override_note:   string | undefined;
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
}: Props) {
  const [mode, setMode]                   = React.useState<CheckoutMode>("normal");
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

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError]           = React.useState<string | null>(null);
  const [confirmed, setConfirmed]   = React.useState(false);
  const [saleId, setSaleId]         = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setMode("normal"); setMethod("cash"); setCashReceived(""); setReference("");
      setSaleDate(today()); setIsHistorical(false); setError(null);
      setConfirmed(false); setSaleId(null); setSubmitting(false);
      setInitialPayment(""); setCreditMethod("cash"); setCreditRef("");
      setDueDate(""); setCreditNotes("");
    }
  }, [open]);

  const gross = totals.gross;

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

  const overriddenItems = cart.filter((i) => i.override_unit_price != null);

  const handleConfirm = async () => {
    if (mode === "normal" && !cashValid) {
      setError("El monto recibido es menor al total."); return;
    }
    if (mode === "credit" && !creditValid) {
      setError("El pago inicial no puede superar el total de la venta."); return;
    }

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
        }, cashSessionId)
      : await createSaleAction({
          ...basePayload,
          payments: [{ method, amount: method === "cash" ? Math.max(cashReceivedNum, gross) : gross, reference: reference || undefined }],
          is_credit: false,
        }, cashSessionId);

    setSubmitting(false);
    if (result?.error) { setError(result.error); return; }
    setSaleId(result?.saleId ?? null);
    setConfirmed(true);
  };

  const handleClose = () => { if (confirmed) onSuccess(); onClose(); };

  // ── Success screen ──────────────────────────────────────────────────────
  if (confirmed) {
    return (
      <Dialog open={open} onClose={handleClose} title="¡Venta registrada!" description="">
        <div className="space-y-5 px-6 py-6 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-signal-500 bg-signal-500/10">
            <CheckCircleIcon className="h-8 w-8 text-signal-500" />
          </div>

          {saleId ? (
            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Venta # {saleId.slice(0, 8).toUpperCase()}
            </p>
          ) : null}

          {mode === "credit" ? (
            <div className="rounded-sm border border-safety-500/30 bg-safety-500/5 px-4 py-3 space-y-1.5 text-left">
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-safety-400/70 mb-2">
                Venta fiada registrada
              </p>
              <SummaryRow label="Total venta"    value={moneyFmt.format(gross)} />
              <SummaryRow label="Abono inicial"  value={moneyFmt.format(initialPaymentNum)} />
              <div className="my-1 h-px bg-steel-700/60" />
              <SummaryRow label="Saldo pendiente" value={moneyFmt.format(creditBalance)} bold />
              {dueDate ? <SummaryRow label="Vence" value={dueDate} /> : null}
            </div>
          ) : (
            <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-3 space-y-1.5 text-left">
              <p className="font-display text-[32px] leading-none tracking-[0.02em] text-safety-500 text-center mb-2">
                {moneyFmt.format(gross)}
              </p>
              <SummaryRow label="Subtotal (neto)" value={moneyFmt.format(totals.net)} />
              <SummaryRow label="IVA"             value={moneyFmt.format(totals.iva)} />
              <div className="my-1 h-px bg-steel-700/60" />
              <SummaryRow label="Total" value={moneyFmt.format(gross)} bold />
              {method === "cash" && change !== null && change > 0 ? (
                <SummaryRow label="Cambio" value={moneyFmt.format(change)} />
              ) : null}
            </div>
          )}

          {overriddenItems.length > 0 ? (
            <div className="rounded-sm border border-signal-700/30 bg-signal-900/20 px-4 py-3 text-left">
              <p className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-signal-500/70">
                Ajustes de precio aplicados
              </p>
              <ul className="space-y-1">
                {overriddenItems.map((item, i) => (
                  <li key={i} className="font-mono text-[10.5px] text-signal-400">
                    {item.price_override_reason ?? PRICE_OVERRIDE_LABELS[(item.price_override_type ?? "price_set") as PriceOverrideType]}
                    {" · "}<span className="tabular-nums">{moneyFmt.format(item.override_unit_price ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button size="md" className="min-w-[130px]" onClick={handleClose}>
            Nueva venta
          </Button>
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

        {/* Mode toggle: Normal / Fiado */}
        <div className="grid grid-cols-2 gap-2 rounded-sm border border-steel-700 p-1">
          <ModeBtn active={mode === "normal"} onClick={() => { setMode("normal"); setError(null); }}>
            <CashIcon className="h-4 w-4" /> Cobro normal
          </ModeBtn>
          <ModeBtn active={mode === "credit"} onClick={() => { setMode("credit"); setError(null); }}>
            <CreditIcon className="h-4 w-4" /> Fiado
          </ModeBtn>
        </div>

        {/* ── Modo NORMAL ────────────────────────────────────────────── */}
        {mode === "normal" ? (
          <>
            {/* Payment method */}
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
          /* ── Modo FIADO ──────────────────────────────────────────────── */
          <div className="space-y-3">
            <div className="rounded-sm border border-safety-500/20 bg-safety-500/5 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-safety-400/80">
                La venta se registra normalmente. El cliente puede abonar después.
              </p>
            </div>

            {/* Pago inicial */}
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

            {/* Saldo a fiar */}
            <div className="flex items-baseline justify-between rounded-sm border-2 border-signal-600/40 bg-signal-700/10 px-4 py-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-signal-400">
                Saldo a fiar
              </span>
              <span className="font-mono text-[18px] font-bold tabular-nums text-signal-400">
                {moneyFmt.format(creditBalance)}
              </span>
            </div>

            {/* Método si hay pago inicial */}
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

            {/* Vencimiento */}
            <div className="space-y-1.5">
              <Label htmlFor="due-date">
                Fecha de vencimiento <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opcional)</span>
              </Label>
              <Input
                id="due-date" type="date" value={dueDate} mono className="h-10"
                min={today()}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            {/* Nota */}
            <div className="space-y-1.5">
              <Label htmlFor="credit-notes">
                Nota / motivo <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opcional)</span>
              </Label>
              <Input
                id="credit-notes" value={creditNotes}
                onChange={(e) => setCreditNotes(e.target.value)}
                placeholder="Ej: Cliente de confianza, paga fin de mes"
                maxLength={200}
              />
            </div>
          </div>
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
          disabled={submitting || (mode === "normal" ? !cashValid : !creditValid)}
          onClick={handleConfirm}
          className="min-w-[130px]"
        >
          {mode === "credit" ? "Registrar fiado" : "Confirmar cobro"}
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
