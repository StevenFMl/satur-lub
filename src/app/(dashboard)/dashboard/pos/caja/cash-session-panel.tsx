"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Big from "big.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import {
  openCashSessionAction,
  closeCashSessionAction,
  addCashMovementAction,
} from "@/actions/cash";
import { MOVEMENT_TYPE_LABELS } from "@/lib/validations/cash";
import type { PosPermissions } from "@/lib/auth/permissions";
import type { CashSessionData, PosWarehouseForCaja, PastSessionRow } from "./page";

// ── Formatters ──────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es-EC", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString("es-EC", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ── Main component ─────────────────────────────────────────────────────────

export function CashSessionPanel({
  session,
  warehouses,
  permissions,
  pastSessions,
}: {
  session:      CashSessionData | null;
  warehouses:   PosWarehouseForCaja[];
  permissions:  PosPermissions;
  pastSessions: PastSessionRow[];
}) {
  const router = useRouter();
  const [manualOpen, setManualOpen]   = React.useState(false);
  const [manualType, setManualType]   = React.useState<"paid_in" | "paid_out">("paid_in");
  const [closeOpen,  setCloseOpen]    = React.useState(false);

  const isOpen   = session?.status === "open";
  const isClosed = session?.status === "closed";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-[22px] tracking-[0.04em]">SESIÓN DE CAJA</h1>
          {session?.warehouse_name ? (
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {session.warehouse_name}
            </p>
          ) : null}
        </div>
        <Link
          href="/dashboard/pos"
          className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          ← POS
        </Link>
      </div>

      {/* ── No session yet ──────────────────────────────────── */}
      {!session ? (
        <div className="panel rounded-sm border border-steel-700 bg-steel-900/60 px-6 py-10 text-center space-y-4">
          <CashIcon className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            No hay sesión de caja activa
          </p>
          {permissions.canOpenCashSession ? (
            <OpenSessionForm warehouses={warehouses} onSuccess={() => router.refresh()} />
          ) : (
            <p className="font-mono text-[10px] text-muted-foreground/50">
              Contacta a un administrador para abrir la caja.
            </p>
          )}
        </div>
      ) : null}

      {/* ── Active session ──────────────────────────────────── */}
      {session ? (
        <>
          {/* Status bar */}
          <div className={[
            "flex items-center justify-between rounded-sm border-2 px-5 py-4",
            isOpen
              ? "border-signal-500/30 bg-signal-500/5"
              : "border-steel-700 bg-steel-900/40",
          ].join(" ")}>
            <div>
              <div className="flex items-center gap-2">
                <span className={[
                  "rounded-sm border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em]",
                  isOpen
                    ? "border-signal-600/40 bg-signal-700/10 text-signal-400"
                    : "border-steel-700 text-muted-foreground/60",
                ].join(" ")}>
                  {isOpen ? "Abierta" : "Cerrada"}
                </span>
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  Apertura: {fmtDatetime(session.opened_at)}
                </span>
              </div>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                Monto inicial: {moneyFmt.format(session.opening_amount)}
              </p>
              {isClosed && session.closed_at ? (
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/50">
                  Cerrada: {fmtDatetime(session.closed_at)}
                </p>
              ) : null}
            </div>

            {isOpen ? (
              <p className="text-right">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60 block">
                  Efectivo esperado
                </span>
                <span className="font-display text-[28px] leading-none tracking-[0.02em] text-safety-500">
                  {moneyFmt.format(session.running_expected)}
                </span>
              </p>
            ) : null}

            {isClosed ? (
              <div className="text-right space-y-0.5">
                <p>
                  <span className="font-mono text-[9px] text-muted-foreground/60 block">Esperado</span>
                  <span className="font-mono font-bold tabular-nums text-foreground">
                    {moneyFmt.format(session.expected_cash ?? 0)}
                  </span>
                </p>
                <p>
                  <span className="font-mono text-[9px] text-muted-foreground/60 block">Contado</span>
                  <span className="font-mono font-bold tabular-nums text-foreground">
                    {moneyFmt.format(session.counted_cash ?? 0)}
                  </span>
                </p>
                <p>
                  <span className="font-mono text-[9px] text-muted-foreground/60 block">
                    {(session.variance ?? 0) >= 0 ? "Sobrante" : "Faltante"}
                  </span>
                  <span className={[
                    "font-mono font-bold tabular-nums",
                    (session.variance ?? 0) === 0
                      ? "text-muted-foreground/50"
                      : (session.variance ?? 0) > 0
                        ? "text-signal-400"
                        : "text-red-400",
                  ].join(" ")}>
                    {(session.variance ?? 0) > 0 ? "+" : ""}
                    {moneyFmt.format(session.variance ?? 0)}
                  </span>
                </p>
              </div>
            ) : null}
          </div>

          {/* Action buttons */}
          {isOpen && (permissions.canManualCashMovement || permissions.canCloseCashSession) ? (
            <div className="flex flex-wrap gap-2">
              {permissions.canManualCashMovement ? (
                <>
                  <button
                    type="button"
                    onClick={() => { setManualType("paid_in"); setManualOpen(true); }}
                    className="flex h-9 items-center gap-1.5 rounded-sm border border-signal-600/40 bg-signal-700/10 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-signal-400 transition-colors hover:bg-signal-700/20"
                  >
                    <PlusIcon className="h-3 w-3" />
                    Ingreso manual
                  </button>
                  <button
                    type="button"
                    onClick={() => { setManualType("paid_out"); setManualOpen(true); }}
                    className="flex h-9 items-center gap-1.5 rounded-sm border border-hazard-500/30 bg-hazard-700/10 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-hazard-500 transition-colors hover:bg-hazard-700/20"
                  >
                    <MinusIcon className="h-3 w-3" />
                    Egreso manual
                  </button>
                </>
              ) : null}
              {permissions.canCloseCashSession ? (
                <button
                  type="button"
                  onClick={() => setCloseOpen(true)}
                  className="ml-auto flex h-9 items-center gap-1.5 rounded-sm border border-red-500/40 bg-red-500/5 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-red-400 transition-colors hover:bg-red-500/10"
                >
                  Cerrar caja
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Open new session after closed */}
          {isClosed && permissions.canOpenCashSession ? (
            <div className="panel rounded-sm border border-steel-700 bg-steel-900/60 px-5 py-4 space-y-3">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/60">
                Abrir nueva sesión
              </p>
              <OpenSessionForm
                warehouses={warehouses}
                defaultWarehouseId={session.warehouse_id}
                onSuccess={() => router.refresh()}
              />
            </div>
          ) : null}

          {/* Conciliación — category breakdown of all movements */}
          <ConciliacionPanel session={session} />

          {/* Movements — extracted to MovementsList for filter support */}
          {session.movements.length > 0 ? (
            <MovementsList session={session} />
          ) : (
            isOpen ? (
              <p className="font-mono text-[11px] text-muted-foreground/50 text-center py-4">
                Sin movimientos aún
              </p>
            ) : null
          )}
        </>
      ) : null}

      {/* ── Session history ─────────────────────────────────── */}
      {pastSessions.length > 0 ? (
        <SessionHistory sessions={pastSessions} />
      ) : null}

      {/* ── Dialogs ─────────────────────────────────────────── */}
      {session?.status === "open" ? (
        <>
          <ManualMovementDialog
            sessionId={session.id}
            type={manualType}
            open={manualOpen}
            onClose={() => setManualOpen(false)}
            onSuccess={() => { setManualOpen(false); router.refresh(); }}
          />
          <CloseSessionDialog
            session={session}
            open={closeOpen}
            onClose={() => setCloseOpen(false)}
            onSuccess={() => { setCloseOpen(false); router.refresh(); }}
          />
        </>
      ) : null}
    </div>
  );
}

// ── OpenSessionForm ────────────────────────────────────────────────────────

function OpenSessionForm({
  warehouses,
  defaultWarehouseId,
  onSuccess,
}: {
  warehouses:          PosWarehouseForCaja[];
  defaultWarehouseId?: string | null;
  onSuccess:           () => void;
}) {
  const [warehouseId, setWarehouseId] = React.useState(defaultWarehouseId ?? (warehouses[0]?.id ?? ""));
  const [amount, setAmount]           = React.useState("0");
  const [notes,  setNotes]            = React.useState("");
  const [loading, setLoading]         = React.useState(false);
  const [error,   setError]           = React.useState<string | null>(null);

  const handleOpen = async () => {
    setLoading(true);
    setError(null);
    const amtNum = parseFloat(amount.replace(",", "."));
    const result = await openCashSessionAction({
      warehouse_id:   warehouseId || null,
      opening_amount: isFinite(amtNum) ? amtNum : 0,
      notes:          notes.trim() || null,
    });
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    onSuccess();
  };

  return (
    <div className="space-y-3">
      {warehouses.length > 1 ? (
        <div className="space-y-1">
          <Label htmlFor="open-warehouse">Bodega</Label>
          <Select
            id="open-warehouse"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">— Sin bodega —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </div>
      ) : null}

      <div className="space-y-1">
        <Label htmlFor="opening-amount">Monto inicial en caja (USD)</Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold text-muted-foreground">$</span>
          <Input
            id="opening-amount"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => { setAmount(e.target.value); setError(null); }}
            onFocus={(e) => e.target.select()}
            mono
            className="pl-7"
            autoFocus
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="open-notes">
          Nota{" "}
          <span className="font-normal text-muted-foreground/50">(opcional)</span>
        </Label>
        <Input
          id="open-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Observaciones del turno..."
          maxLength={300}
        />
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button
        onClick={handleOpen}
        loading={loading}
        size="md"
        className="w-full"
      >
        Abrir caja
      </Button>
    </div>
  );
}

// ── ManualMovementDialog ───────────────────────────────────────────────────

function ManualMovementDialog({
  sessionId,
  type,
  open,
  onClose,
  onSuccess,
}: {
  sessionId: string;
  type:      "paid_in" | "paid_out";
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const [amount,  setAmount]  = React.useState("");
  const [reason,  setReason]  = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error,   setError]   = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setAmount(""); setReason(""); setError(null); setLoading(false); }
  }, [open]);

  const amtNum    = parseFloat(amount.replace(",", "."));
  const amtValid  = isFinite(amtNum) && amtNum > 0;
  const canSubmit = amtValid && reason.trim().length >= 3 && !loading;
  const isIn      = type === "paid_in";

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    const result = await addCashMovementAction({
      session_id:    sessionId,
      movement_type: type,
      amount:        Number(Big(amtNum).round(2, Big.roundHalfUp).toFixed(2)),
      reason:        reason.trim(),
    });
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    onSuccess();
  };

  return (
    <Dialog
      open={open}
      onClose={!loading ? onClose : () => {}}
      title={isIn ? "Ingreso de caja" : "Egreso de caja"}
      description=""
    >
      <div className="space-y-4 px-6 py-5">
        <div className="space-y-1.5">
          <Label htmlFor="manual-amount">
            {isIn ? "Monto recibido" : "Monto entregado"} (USD)
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold text-muted-foreground">$</span>
            <Input
              id="manual-amount"
              type="number"
              min={0.01}
              step="0.01"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(null); }}
              onFocus={(e) => e.target.select()}
              mono
              className="pl-7"
              autoFocus
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="manual-reason">
            Motivo{" "}<span className="font-normal text-red-400">*</span>
          </Label>
          <Input
            id="manual-reason"
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(null); }}
            placeholder={isIn ? "Ej: Depósito de propietario, fondo de cambio..." : "Ej: Pago a proveedor, gastos de envío..."}
            maxLength={200}
          />
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>

      <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
        <Button variant="outline" size="md" onClick={onClose} disabled={loading}>
          Cancelar
        </Button>
        <Button
          size="md"
          loading={loading}
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="min-w-[140px]"
        >
          {isIn ? "Registrar ingreso" : "Registrar egreso"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── CloseSessionDialog ─────────────────────────────────────────────────────

function CloseSessionDialog({
  session,
  open,
  onClose,
  onSuccess,
}: {
  session:   CashSessionData;
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const [counted,  setCounted]  = React.useState(session.running_expected.toFixed(2));
  const [notes,    setNotes]    = React.useState("");
  const [loading,  setLoading]  = React.useState(false);
  const [error,    setError]    = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setCounted(session.running_expected.toFixed(2));
      setNotes("");
      setError(null);
      setLoading(false);
    }
  }, [open, session.running_expected]);

  const countedNum  = parseFloat(counted.replace(",", "."));
  const countedOk   = isFinite(countedNum) && countedNum >= 0;
  const variance    = countedOk ? Big(countedNum).minus(Big(session.running_expected)) : null;

  const handleClose = async () => {
    if (!countedOk) return;
    setLoading(true);
    setError(null);
    const result = await closeCashSessionAction({
      session_id:   session.id,
      counted_cash: countedNum,
      notes:        notes.trim() || null,
    });
    setLoading(false);
    if (result?.error) { setError(result.error); return; }
    onSuccess();
  };

  return (
    <Dialog
      open={open}
      onClose={!loading ? onClose : () => {}}
      title="Cerrar sesión de caja"
      description=""
    >
      <div className="space-y-4 px-6 py-5">
        {/* Summary */}
        <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-4 py-3 space-y-1.5">
          <div className="flex justify-between text-[11.5px]">
            <span className="font-mono uppercase tracking-[0.1em] text-muted-foreground/70">Apertura</span>
            <span className="font-mono tabular-nums">{moneyFmt.format(session.opening_amount)}</span>
          </div>
          <div className="flex justify-between text-[11.5px]">
            <span className="font-mono uppercase tracking-[0.1em] text-muted-foreground/70">Efectivo esperado</span>
            <span className="font-display text-[18px] leading-none text-safety-500">
              {moneyFmt.format(session.running_expected)}
            </span>
          </div>
        </div>

        {/* Counted input */}
        <div className="space-y-1.5">
          <Label htmlFor="counted-cash">Efectivo contado (USD)</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold text-muted-foreground">$</span>
            <Input
              id="counted-cash"
              type="number"
              min={0}
              step="0.01"
              value={counted}
              onChange={(e) => { setCounted(e.target.value); setError(null); }}
              onFocus={(e) => e.target.select()}
              mono
              className="h-11 pl-7 text-right text-[16px]"
              autoFocus
            />
          </div>
        </div>

        {/* Variance */}
        {variance !== null ? (
          <div className={[
            "flex items-baseline justify-between rounded-sm border px-3 py-2",
            variance.gte(0)
              ? "border-signal-600/30 bg-signal-700/10"
              : "border-red-500/30 bg-red-500/5",
          ].join(" ")}>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground/70">
              {variance.gte(0) ? "Sobrante" : "Faltante"}
            </span>
            <span className={[
              "font-mono text-[15px] font-bold tabular-nums",
              variance.gte(0) ? "text-signal-400" : "text-red-400",
            ].join(" ")}>
              {variance.gte(0) ? "+" : ""}
              {moneyFmt.format(Number(variance.toFixed(2)))}
            </span>
          </div>
        ) : null}

        {/* Notes */}
        <div className="space-y-1.5">
          <Label htmlFor="close-notes">
            Nota{" "}<span className="font-normal text-muted-foreground/50">(opcional)</span>
          </Label>
          <Input
            id="close-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observaciones del cierre..."
            maxLength={300}
          />
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>

      <div className="flex items-center justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
        <Button variant="outline" size="md" onClick={onClose} disabled={loading}>
          Cancelar
        </Button>
        <button
          type="button"
          disabled={!countedOk || loading}
          onClick={handleClose}
          className={[
            "inline-flex h-10 items-center justify-center gap-2 rounded-sm border-2 px-5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-all",
            countedOk && !loading
              ? "border-red-500/70 bg-red-500/10 text-red-400 hover:bg-red-500/20"
              : "cursor-not-allowed border-steel-700 text-muted-foreground/40",
          ].join(" ")}
        >
          {loading ? "Cerrando..." : "Confirmar cierre"}
        </button>
      </div>
    </Dialog>
  );
}

// ── ConciliacionPanel ─────────────────────────────────────────────────────
// Expandable breakdown of cash movements by category.
// Distinguishes: ventas | abonos fiado | devoluciones | reembolso crédito cambio | manuales.

const EXCHANGE_CREDIT_REASON = "Devolución de crédito restante por cambio de producto";

function ConciliacionPanel({ session }: { session: CashSessionData }) {
  const [open, setOpen] = React.useState(false);

  const mvs = session.movements;
  if (mvs.length === 0) return null;

  // Categorize movements
  const ventas      = mvs.filter(m => m.movement_type === "cash_in"  && m.reference_type === "sale");
  const abonosFiado = mvs.filter(m => m.movement_type === "cash_in"  && m.reference_type !== "sale");
  const paidIn      = mvs.filter(m => m.movement_type === "paid_in");
  const devNormal   = mvs.filter(m => m.movement_type === "cash_out" && m.reference_type === "sale_return" && m.reason !== EXCHANGE_CREDIT_REASON);
  const devCambio   = mvs.filter(m => m.movement_type === "cash_out" && m.reference_type === "sale_return" && m.reason === EXCHANGE_CREDIT_REASON);
  const devOtro     = mvs.filter(m => m.movement_type === "cash_out" && m.reference_type !== "sale_return");
  const paidOut     = mvs.filter(m => m.movement_type === "paid_out");

  const sum = (arr: typeof mvs) => arr.reduce((s, m) => s + m.amount, 0);

  const totalIn  = sum(ventas) + sum(abonosFiado) + sum(paidIn);
  const totalOut = sum(devNormal) + sum(devCambio) + sum(devOtro) + sum(paidOut);

  const isOpen   = session.status === "open";
  const isClosed = session.status === "closed";

  return (
    <div className="rounded-sm border border-steel-700 bg-steel-900/60 overflow-hidden">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-steel-800/30 transition-colors"
      >
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
          Conciliación de caja
        </span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] font-bold tabular-nums text-safety-500">
            {moneyFmt.format(session.running_expected)}
          </span>
          <ChevronDownIcon className={[
            "h-3.5 w-3.5 text-muted-foreground/40 transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")} />
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-steel-700 px-4 py-3 space-y-0">
          {/* ── Entradas ─────────────────────────────── */}
          <ConcilRow label="Apertura" value={session.opening_amount} sign="neutral" />

          {sum(ventas) > 0 && (
            <ConcilRow label="Ventas en efectivo" value={sum(ventas)} sign="in"
              detail={`${ventas.length} venta${ventas.length !== 1 ? "s" : ""}`} />
          )}
          {sum(abonosFiado) > 0 && (
            <ConcilRow label="Abonos fiado" value={sum(abonosFiado)} sign="in"
              detail={`${abonosFiado.length} abono${abonosFiado.length !== 1 ? "s" : ""}`} />
          )}
          {sum(paidIn) > 0 && (
            <ConcilRow label="Ingresos manuales" value={sum(paidIn)} sign="in"
              detail={`${paidIn.length} mov.`} />
          )}

          {totalIn > 0 && (
            <div className="flex items-baseline justify-between py-1.5 border-b border-steel-800/50 mb-1">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/40">
                Total entradas
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-signal-400/70">
                +{moneyFmt.format(totalIn)}
              </span>
            </div>
          )}

          {/* ── Salidas ──────────────────────────────── */}
          {sum(devNormal) > 0 && (
            <ConcilRow label="Devoluciones en efectivo" value={sum(devNormal)} sign="out"
              detail={`${devNormal.length} devol.`} />
          )}
          {sum(devCambio) > 0 && (
            <ConcilRow label="Reembolso crédito cambio" value={sum(devCambio)} sign="out"
              detail={`${devCambio.length} cambio${devCambio.length !== 1 ? "s" : ""}`} />
          )}
          {sum(devOtro) > 0 && (
            <ConcilRow label="Otros egresos (cash_out)" value={sum(devOtro)} sign="out"
              detail={`${devOtro.length} mov.`} />
          )}
          {sum(paidOut) > 0 && (
            <ConcilRow label="Egresos manuales" value={sum(paidOut)} sign="out"
              detail={`${paidOut.length} mov.`} />
          )}

          {totalOut > 0 && (
            <div className="flex items-baseline justify-between py-1.5 border-b border-steel-800/50 mb-1">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/40">
                Total salidas
              </span>
              <span className="font-mono text-[10.5px] tabular-nums text-hazard-500/70">
                −{moneyFmt.format(totalOut)}
              </span>
            </div>
          )}

          {/* ── Saldo esperado ───────────────────────── */}
          <div className="flex items-baseline justify-between pt-1.5">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-foreground">
              {isOpen ? "Saldo esperado" : "Total calculado"}
            </span>
            <span className="font-display text-[22px] leading-none text-safety-500">
              {moneyFmt.format(session.running_expected)}
            </span>
          </div>

          {/* ── Real vs calculado (closed sessions) ───── */}
          {isClosed && session.counted_cash != null && (
            <>
              <div className="flex items-baseline justify-between pt-1">
                <span className="font-mono text-[10.5px] text-muted-foreground/60">Efectivo contado</span>
                <span className="font-mono font-bold tabular-nums text-foreground">
                  {moneyFmt.format(session.counted_cash)}
                </span>
              </div>
              <div className={[
                "flex items-baseline justify-between rounded-sm border px-3 py-1.5 mt-2",
                (session.variance ?? 0) >= 0
                  ? "border-signal-600/30 bg-signal-700/10"
                  : "border-red-500/30 bg-red-500/5",
              ].join(" ")}>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground/60">
                  {(session.variance ?? 0) >= 0 ? "Sobrante" : "Faltante"}
                </span>
                <span className={[
                  "font-mono text-[14px] font-bold tabular-nums",
                  (session.variance ?? 0) >= 0 ? "text-signal-400" : "text-red-400",
                ].join(" ")}>
                  {(session.variance ?? 0) > 0 ? "+" : ""}
                  {moneyFmt.format(session.variance ?? 0)}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConcilRow({
  label, value, sign, detail,
}: {
  label:   string;
  value:   number;
  sign:    "in" | "out" | "neutral";
  detail?: string;
}) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10.5px] text-muted-foreground/70">{label}</span>
        {detail && (
          <span className="font-mono text-[9px] text-muted-foreground/40">{detail}</span>
        )}
      </div>
      <span className={[
        "font-mono text-[11px] font-semibold tabular-nums",
        sign === "in"      ? "text-signal-400"
        : sign === "out"   ? "text-hazard-500"
        :                    "text-muted-foreground",
      ].join(" ")}>
        {sign === "in" ? "+" : sign === "out" ? "−" : " "}
        {moneyFmt.format(value)}
      </span>
    </div>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ── MovementsList ──────────────────────────────────────────────────────────
// Extracted from CashSessionPanel to support the "solo reembolsos" filter.

function MovementsList({ session }: { session: CashSessionData }) {
  const [onlyReturns, setOnlyReturns] = React.useState(false);

  const isOpen = session.status === "open";

  const displayed = onlyReturns
    ? session.movements.filter((m) => m.reference_type === "sale_return")
    : session.movements;

  const cashIn  = session.movements.filter(m => m.direction ===  1 && m.movement_type === "cash_in").reduce((a,m)=>a+m.amount,0);
  const cashOut = session.movements.filter(m => m.direction === -1 && m.movement_type === "cash_out").reduce((a,m)=>a+m.amount,0);
  const paidIn  = session.movements.filter(m => m.movement_type === "paid_in").reduce((a,m)=>a+m.amount,0);
  const paidOut = session.movements.filter(m => m.movement_type === "paid_out").reduce((a,m)=>a+m.amount,0);

  const returnMovements = session.movements.filter(m => m.reference_type === "sale_return");

  return (
    <div className="panel rounded-sm border border-steel-700 bg-steel-900/60 overflow-hidden">
      {/* Header + filter toggle */}
      <div className="flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-4 py-2.5">
        <h2 className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
          Movimientos ({session.movements.length})
        </h2>
        {returnMovements.length > 0 ? (
          <button
            type="button"
            onClick={() => setOnlyReturns((p) => !p)}
            className={[
              "flex items-center gap-1 rounded-sm border px-2 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] transition-colors",
              onlyReturns
                ? "border-signal-500/60 bg-signal-700/20 text-signal-400"
                : "border-steel-600/60 text-muted-foreground/60 hover:border-steel-500 hover:text-muted-foreground",
            ].join(" ")}
          >
            <ReturnIcon className="h-2.5 w-2.5" />
            Reembolsos ({returnMovements.length})
          </button>
        ) : null}
      </div>

      {/* Movement rows */}
      <ul className="divide-y divide-steel-800/40 max-h-[360px] overflow-y-auto">
        {displayed.length === 0 ? (
          <li className="px-4 py-3 font-mono text-[10.5px] text-muted-foreground/40 text-center">
            Sin reembolsos en esta sesión
          </li>
        ) : (
          displayed.map((m) => {
            const isIn      = m.direction === 1;
            const isReturn  = m.reference_type === "sale_return";
            return (
              <li key={m.id} className={[
                "flex items-center gap-3 px-4 py-2.5",
                isReturn ? "bg-signal-950/20" : "",
              ].join(" ")}>
                <span className={[
                  "shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.08em]",
                  isIn ? "text-signal-400" : "text-hazard-500",
                ].join(" ")}>
                  {isIn ? "+" : "−"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/60">
                      {MOVEMENT_TYPE_LABELS[m.movement_type] ?? m.movement_type}
                    </span>
                    {isReturn ? (
                      <span className="rounded-sm border border-signal-600/30 bg-signal-700/10 px-1 py-px font-mono text-[7.5px] font-bold uppercase text-signal-400/70">
                        Devolución
                      </span>
                    ) : null}
                    <span className="font-mono text-[10px] text-muted-foreground/50">
                      {fmtTime(m.created_at)}
                    </span>
                  </div>
                  <div className="truncate text-[11.5px] text-foreground">{m.reason}</div>
                </div>
                <span className={[
                  "shrink-0 font-mono text-[12.5px] font-bold tabular-nums",
                  isIn ? "text-signal-400" : "text-muted-foreground",
                ].join(" ")}>
                  {isIn ? "+" : "−"}{moneyFmt.format(m.amount)}
                </span>
              </li>
            );
          })
        )}
      </ul>

      {/* Running summary */}
      <div className="border-t border-steel-700 bg-steel-950/50 px-4 py-2.5 space-y-1.5">
        <div className="flex justify-between text-[11px]">
          <span className="font-mono uppercase tracking-[0.1em] text-muted-foreground/60">Apertura</span>
          <span className="font-mono tabular-nums text-muted-foreground">{moneyFmt.format(session.opening_amount)}</span>
        </div>
        {cashIn  > 0 && <div className="flex justify-between text-[11px]"><span className="font-mono text-muted-foreground/60">Ventas efectivo</span><span className="font-mono tabular-nums text-signal-400">+{moneyFmt.format(cashIn)}</span></div>}
        {cashOut > 0 && <div className="flex justify-between text-[11px]"><span className="font-mono text-muted-foreground/60">Reembolsos efectivo</span><span className="font-mono tabular-nums text-hazard-500">−{moneyFmt.format(cashOut)}</span></div>}
        {paidIn  > 0 && <div className="flex justify-between text-[11px]"><span className="font-mono text-muted-foreground/60">Ingresos manuales</span><span className="font-mono tabular-nums text-signal-400">+{moneyFmt.format(paidIn)}</span></div>}
        {paidOut > 0 && <div className="flex justify-between text-[11px]"><span className="font-mono text-muted-foreground/60">Egresos manuales</span><span className="font-mono tabular-nums text-hazard-500">−{moneyFmt.format(paidOut)}</span></div>}
        <div className="flex items-baseline justify-between border-t border-steel-800/60 pt-1.5">
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-foreground">
            {isOpen ? "Efectivo esperado" : "Total calculado"}
          </span>
          <span className="font-display text-[20px] leading-none text-safety-500">
            {moneyFmt.format(session.running_expected)}
          </span>
        </div>
      </div>
    </div>
  );
}

function ReturnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

// ── SessionHistory ─────────────────────────────────────────────────────────

function SessionHistory({ sessions }: { sessions: PastSessionRow[] }) {
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? sessions : sessions.slice(0, 5);

  return (
    <div className="panel rounded-sm border border-steel-700 bg-steel-900/60 overflow-hidden">
      <div className="flex items-center justify-between border-b border-steel-700 bg-steel-900/70 px-4 py-2.5">
        <h2 className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground/60">
          Historial de sesiones ({sessions.length})
        </h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left">
          <thead className="border-b border-steel-800 bg-steel-950/40">
            <tr>
              <th className="px-4 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">Apertura</th>
              <th className="px-4 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">Cierre</th>
              <th className="px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60 text-right">Inicial</th>
              <th className="px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60 text-right">Contado</th>
              <th className="px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60 text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => {
              const v    = s.variance ?? null;
              const zero = v === null || v === 0;
              return (
                <tr key={s.id} className="border-b border-steel-800/40 hover:bg-steel-900/40 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {s.status === "open" ? (
                        <span className="rounded-sm border border-signal-600/40 bg-signal-700/10 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase text-signal-400">
                          Abierta
                        </span>
                      ) : null}
                      <span className="font-mono text-[11px] text-foreground">
                        {fmtDatetime(s.opened_at)}
                      </span>
                    </div>
                    {s.warehouse_name ? (
                      <div className="font-mono text-[9px] text-muted-foreground/50 mt-0.5">
                        {s.warehouse_name}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {s.closed_at ? fmtDatetime(s.closed_at) : "—"}
                    </span>
                    {s.notes ? (
                      <div
                        className="mt-0.5 max-w-[140px] truncate font-mono text-[9px] text-muted-foreground/50"
                        title={s.notes}
                      >
                        {s.notes}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {moneyFmt.format(s.opening_amount)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[11.5px] tabular-nums text-foreground">
                    {s.counted_cash != null ? moneyFmt.format(s.counted_cash) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {v === null ? (
                      <span className="font-mono text-[10px] text-muted-foreground/40">—</span>
                    ) : (
                      <span className={[
                        "font-mono text-[12px] font-bold tabular-nums",
                        zero  ? "text-muted-foreground/40" :
                        v > 0 ? "text-signal-400"          :
                                "text-red-400",
                      ].join(" ")}>
                        {v > 0 ? "+" : ""}{moneyFmt.format(v)}
                        {!zero ? (
                          <span className="ml-1 font-mono text-[9px] font-normal">
                            {v > 0 ? "sobra" : "falta"}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sessions.length > 5 ? (
        <div className="border-t border-steel-800 px-4 py-2">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60 transition-colors hover:text-foreground"
          >
            {expanded ? `▲ Mostrar menos` : `▼ Ver ${sessions.length - 5} sesiones más`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function CashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" />
    </svg>
  );
}
