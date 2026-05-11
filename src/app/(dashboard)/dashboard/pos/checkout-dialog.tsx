"use client";

import * as React from "react";
import Big from "big.js";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { createSaleAction } from "@/actions/sales";

type PaymentMethod = "cash" | "card" | "transfer";

type CartItem = {
  product_id:      string;
  quantity:        number;
  discount_amount: number;
  presentation_id: string | null | undefined;
  base_qty:        number;
};

type Props = {
  open:        boolean;
  onClose:     () => void;
  cart:        CartItem[];
  totals:      { gross: number; net: number; iva: number };
  customerId:  string;
  warehouseId: string | null;
  onSuccess:   () => void;
};

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const METHODS: { method: PaymentMethod; label: string; icon: React.ReactNode }[] = [
  { method: "cash",     label: "Efectivo",      icon: <CashIcon className="h-5 w-5" /> },
  { method: "card",     label: "Tarjeta",        icon: <CardIcon className="h-5 w-5" /> },
  { method: "transfer", label: "Transferencia",  icon: <TransferIcon className="h-5 w-5" /> },
];

const today = () => new Date().toISOString().slice(0, 10);

export function CheckoutDialog({
  open,
  onClose,
  cart,
  totals,
  customerId,
  warehouseId,
  onSuccess,
}: Props) {
  const [method, setMethod]               = React.useState<PaymentMethod>("cash");
  const [cashReceived, setCashReceived]   = React.useState("");
  const [reference, setReference]         = React.useState("");
  const [saleDate, setSaleDate]           = React.useState(today());
  const [isHistorical, setIsHistorical]   = React.useState(false);
  const [submitting, setSubmitting]       = React.useState(false);
  const [error, setError]                 = React.useState<string | null>(null);
  const [confirmed, setConfirmed]         = React.useState(false);
  const [saleId, setSaleId]               = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setMethod("cash");
      setCashReceived("");
      setReference("");
      setSaleDate(today());
      setIsHistorical(false);
      setError(null);
      setConfirmed(false);
      setSaleId(null);
      setSubmitting(false);
    }
  }, [open]);

  const gross = totals.gross;

  const cashReceivedNum = React.useMemo(() => {
    const n = parseFloat(cashReceived.replace(",", "."));
    return isFinite(n) ? n : 0;
  }, [cashReceived]);

  const change = React.useMemo(() => {
    if (method !== "cash") return null;
    const c = Big(cashReceivedNum).minus(Big(gross));
    return c.gte(0) ? Number(c.round(2).toString()) : null;
  }, [cashReceivedNum, gross, method]);

  const cashValid = method !== "cash" || cashReceivedNum >= gross - 0.001;

  const handleConfirm = async () => {
    if (!cashValid) { setError("El monto recibido es menor al total."); return; }

    setSubmitting(true);
    setError(null);

    const result = await createSaleAction({
      customer_id:   customerId,
      warehouse_id:  warehouseId,
      items:         cart.map((l) => ({
        product_id:      l.product_id,
        quantity:        l.quantity,
        discount_amount: l.discount_amount,
        presentation_id: l.presentation_id ?? undefined,
        base_qty:        l.base_qty,
      })),
      payments: [{
        method,
        amount:    method === "cash" ? Math.max(cashReceivedNum, gross) : gross,
        reference: reference || undefined,
      }],
      document_kind: "ticket",
      sale_date:     isHistorical ? saleDate : null,
    });

    setSubmitting(false);

    if (result?.error) { setError(result.error); return; }

    setSaleId(result?.saleId ?? null);
    setConfirmed(true);
  };

  const handleClose = () => {
    if (confirmed) onSuccess();
    onClose();
  };

  // ── Success ──────────────────────────────────────────────────
  if (confirmed) {
    return (
      <Dialog open={open} onClose={handleClose} title="¡Venta registrada!" description="">
        <div className="space-y-5 px-6 py-6 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-signal-500 bg-signal-500/10">
            <CheckCircleIcon className="h-8 w-8 text-signal-500" />
          </div>

          <div className="space-y-1">
            {saleId ? (
              <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                Venta # {saleId.slice(0, 8).toUpperCase()}
              </p>
            ) : null}
            <p className="font-display text-[32px] leading-none tracking-[0.02em] text-safety-500">
              {moneyFmt.format(gross)}
            </p>
            {method === "cash" && change !== null && change > 0 ? (
              <p className="mt-1.5 font-mono text-[14px] text-foreground">
                Cambio:{" "}
                <span className="font-bold text-signal-400">{moneyFmt.format(change)}</span>
              </p>
            ) : null}
          </div>

          <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-3 space-y-1.5 text-left">
            <SummaryRow label="Subtotal (neto)" value={moneyFmt.format(totals.net)} />
            <SummaryRow label="IVA 15%" value={moneyFmt.format(totals.iva)} />
            <div className="my-1 h-px bg-steel-700/60" />
            <SummaryRow label="Total" value={moneyFmt.format(gross)} bold />
            <SummaryRow label={METHODS.find((m) => m.method === method)?.label ?? method} value="" />
          </div>
        </div>

        <div className="flex justify-end border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button size="md" className="min-w-[130px]" onClick={handleClose}>
            Nueva venta
          </Button>
        </div>
      </Dialog>
    );
  }

  // ── Form ─────────────────────────────────────────────────────
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

        {/* Subtotal / IVA */}
        <div className="space-y-1 text-[12px]">
          <SummaryRow label="Subtotal (neto)" value={moneyFmt.format(totals.net)} />
          <SummaryRow label="IVA 15%" value={moneyFmt.format(totals.iva)} />
        </div>

        {/* Payment method */}
        <div className="space-y-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            Método de pago
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map(({ method: m, label, icon }) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMethod(m); setError(null); }}
                className={[
                  "flex flex-col items-center gap-1.5 rounded-sm border-2 px-2 py-2.5 transition-all",
                  method === m
                    ? "border-safety-500 bg-safety-500/10 text-safety-500 shadow-safety-glow"
                    : "border-steel-700 bg-steel-900 text-muted-foreground hover:border-steel-600 hover:text-foreground",
                ].join(" ")}
              >
                {icon}
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.1em]">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Cash received */}
        {method === "cash" ? (
          <div className="space-y-1.5">
            <Label htmlFor="cash-received">Monto recibido</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                USD
              </span>
              <Input
                id="cash-received"
                type="number"
                min={0}
                step="0.01"
                value={cashReceived}
                onChange={(e) => { setCashReceived(e.target.value); setError(null); }}
                placeholder={String(gross.toFixed(2))}
                mono
                className="h-11 pl-14 text-right text-[15px]"
                onFocus={(e) => e.target.select()}
                autoFocus
              />
            </div>
            {change !== null && change >= 0 ? (
              <div className="flex items-baseline justify-between rounded-sm border border-signal-600/30 bg-signal-700/15 px-3 py-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-signal-400">Cambio</span>
                <span className="font-mono text-[15px] font-bold tabular-nums text-signal-400">
                  {moneyFmt.format(change)}
                </span>
              </div>
            ) : cashReceived && !cashValid ? (
              <p className="font-mono text-[11px] text-red-400">
                Faltan {moneyFmt.format(gross - cashReceivedNum)}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Card / transfer reference */}
        {method !== "cash" ? (
          <div className="space-y-1.5">
            <Label htmlFor="reference">
              Referencia{" "}
              <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
                (opcional)
              </span>
            </Label>
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={method === "card" ? "Últimos 4 dígitos" : "N.° transferencia"}
              maxLength={60}
              autoFocus
            />
          </div>
        ) : null}

        {/* Historical sale date */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setIsHistorical((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <ChevronIcon
              className={"h-3 w-3 transition-transform " + (isHistorical ? "rotate-90" : "")}
            />
            Registrar con fecha diferente (venta histórica)
          </button>
          {isHistorical ? (
            <Input
              type="date"
              value={saleDate}
              max={today()}
              onChange={(e) => setSaleDate(e.target.value)}
              mono
              className="h-10"
              aria-label="Fecha de venta"
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
          size="md"
          loading={submitting}
          disabled={!cashValid || submitting}
          onClick={handleConfirm}
          className="min-w-[130px]"
        >
          Confirmar cobro
        </Button>
      </div>
    </Dialog>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

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

// ── Icons ──────────────────────────────────────────────────────────────────

function CashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function CardIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function TransferIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
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
