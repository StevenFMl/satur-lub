"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { adjustInventoryAction } from "@/actions/inventory";
import type { StockRow } from "./stock-table";

// ── Preset reasons ──────────────────────────────────────────────────────────

const REASON_PRESETS = [
  "Inventario físico",
  "Merma / pérdida",
  "Producto dañado",
  "Error de registro",
  "Saldo inicial",
  "Devolución interna",
  "Otro",
] as const;

type ReasonPreset = (typeof REASON_PRESETS)[number];

// ── Formatters ──────────────────────────────────────────────────────────────

const numFmt = new Intl.NumberFormat("es-EC", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

// ── Component ───────────────────────────────────────────────────────────────

type Props = {
  open:     boolean;
  onClose:  () => void;
  onSuccess: (qtyBefore: number, qtyAfter: number, delta: number) => void;
  row:      StockRow | null;
};

export function AdjustmentDialog({ open, onClose, onSuccess, row }: Props) {
  // Mode: 'absolute' = set stock to a value; 'relative' = add/subtract delta
  const [kind, setKind] = React.useState<"absolute" | "relative">("absolute");

  // Relative sub-mode: positive or negative
  const [sign, setSign] = React.useState<"+" | "-">("+");

  const [qtyStr, setQtyStr]         = React.useState("");
  const [reasonPreset, setReasonPreset] = React.useState<ReasonPreset>("Inventario físico");
  const [customReason, setCustomReason] = React.useState("");
  const [note, setNote]             = React.useState("");
  const [overrideCost, setOverrideCost] = React.useState(false);
  const [costStr, setCostStr]       = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError]           = React.useState<string | null>(null);
  const [done, setDone]             = React.useState<{ before: number; after: number; delta: number } | null>(null);

  // Reset on open
  React.useEffect(() => {
    if (!open) return;
    setKind("absolute");
    setSign("+");
    setQtyStr("");
    setReasonPreset("Inventario físico");
    setCustomReason("");
    setNote("");
    setOverrideCost(false);
    setCostStr("");
    setError(null);
    setDone(null);
    // Pre-fill cost from product's average_cost
    if (row?.average_cost != null) {
      setCostStr(row.average_cost.toFixed(4));
    }
  }, [open, row]);

  if (!row) return null;

  const currentStock = row.quantity_on_hand;
  const avgCost      = row.average_cost ?? 0;

  // Parse input quantity
  const qtyNum = parseFloat(qtyStr.replace(",", "."));
  const qtyValid = isFinite(qtyNum) && qtyNum >= 0;

  // Compute the signed delta and resulting stock
  const delta = (() => {
    if (!qtyValid) return null;
    if (kind === "absolute") return qtyNum - currentStock;
    return sign === "+" ? qtyNum : -qtyNum;
  })();
  const qtyAfter = delta !== null ? currentStock + delta : null;
  const isValidChange = delta !== null && delta !== 0 && (qtyAfter ?? -1) >= 0;

  const effectiveReason = reasonPreset === "Otro" ? customReason.trim() : reasonPreset;
  const reasonValid = effectiveReason.length >= 3;

  const costNum = overrideCost ? parseFloat(costStr.replace(",", ".")) : null;
  const costValid = !overrideCost || (isFinite(costNum!) && costNum! >= 0);

  const canSave = isValidChange && reasonValid && costValid && !submitting;

  const handleSave = async () => {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);

    const res = await adjustInventoryAction({
      warehouse_id: row.warehouse_id,
      product_id:   row.product_id,
      kind,
      quantity:     kind === "absolute" ? qtyNum : (sign === "+" ? qtyNum : -qtyNum),
      unit_cost:    overrideCost && costNum !== null ? costNum : null,
      reason:       effectiveReason,
      note:         note.trim() || null,
    });

    setSubmitting(false);

    if (res?.error) {
      setError(res.error);
      return;
    }

    setDone({ before: res?.qtyBefore ?? currentStock, after: res?.qtyAfter ?? 0, delta: res?.delta ?? 0 });
  };

  // ── Success screen ─────────────────────────────────────────────────────
  if (done) {
    const increased = done.delta > 0;
    return (
      <Dialog open={open} onClose={onClose} title="Ajuste registrado" description="">
        <div className="space-y-5 px-6 py-6 text-center">
          <div className={[
            "mx-auto grid h-14 w-14 place-items-center rounded-full border-2",
            increased ? "border-emerald-500/50 bg-emerald-500/10" : "border-orange-500/50 bg-orange-500/10",
          ].join(" ")}>
            <span className={["font-mono text-[20px] font-bold", increased ? "text-emerald-400" : "text-orange-400"].join(" ")}>
              {increased ? "+" : "−"}
            </span>
          </div>
          <div>
            <p className="font-display text-[15px] font-bold text-foreground">{row.product_name}</p>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{row.warehouse_name}</p>
          </div>
          <div className="rounded-sm border border-steel-700 bg-steel-900/60 px-5 py-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">Antes</p>
                <p className="mt-0.5 font-mono text-[18px] font-bold tabular-nums text-foreground">{numFmt.format(done.before)}</p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">Cambio</p>
                <p className={[
                  "mt-0.5 font-mono text-[18px] font-bold tabular-nums",
                  increased ? "text-emerald-400" : "text-orange-400",
                ].join(" ")}>
                  {increased ? "+" : ""}{numFmt.format(done.delta)}
                </p>
              </div>
              <div>
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">Después</p>
                <p className="mt-0.5 font-mono text-[18px] font-bold tabular-nums text-safety-500">{numFmt.format(done.after)}</p>
              </div>
            </div>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground/70">
            Motivo: <span className="text-foreground">{effectiveReason}</span>
          </p>
        </div>
        <div className="flex justify-end border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
          <Button size="md" onClick={() => { onSuccess(done.before, done.after, done.delta); onClose(); }}>
            Listo
          </Button>
        </div>
      </Dialog>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────
  return (
    <Dialog
      open={open}
      onClose={!submitting ? onClose : () => {}}
      title="Ajuste de inventario"
      description={`${row.product_name} · ${row.warehouse_name}`}
    >
      <div className="space-y-5 px-6 py-5">
        {/* Current stock info */}
        <div className="grid grid-cols-3 gap-3">
          <StockCard label="Stock actual" value={numFmt.format(currentStock)} unit={row.unit} />
          <StockCard label="CPP actual"   value={moneyFmt.format(avgCost)} />
          <StockCard label="SKU"          value={row.sku} />
        </div>

        {/* Mode toggle */}
        <div className="space-y-1.5">
          <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">
            Tipo de ajuste
          </span>
          <div className="grid grid-cols-2 overflow-hidden rounded-sm border border-steel-700">
            {(["absolute", "relative"] as const).map((k) => (
              <button
                key={k} type="button"
                onClick={() => setKind(k)}
                className={[
                  "px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] transition-colors",
                  kind === k ? "bg-safety-500 text-steel-950" : "text-muted-foreground hover:bg-steel-800 hover:text-foreground",
                ].join(" ")}
              >
                {k === "absolute" ? "Cantidad exacta" : "Diferencia ±"}
              </button>
            ))}
          </div>
          <p className="font-mono text-[10px] text-muted-foreground/55">
            {kind === "absolute"
              ? "Ingresa la cantidad real que hay en bodega. El sistema calcula la diferencia."
              : "Ingresa cuántas unidades sumar o restar al stock actual."}
          </p>
        </div>

        {/* Quantity input */}
        <div className="space-y-1.5">
          <Label htmlFor="adj-qty" required>
            {kind === "absolute" ? "Nueva cantidad en bodega" : "Cantidad a ajustar"}
          </Label>
          {kind === "relative" ? (
            <div className="flex items-stretch gap-2">
              {/* Sign toggle */}
              <div className="flex overflow-hidden rounded-sm border border-steel-700">
                {(["+", "-"] as const).map((s) => (
                  <button
                    key={s} type="button"
                    onClick={() => setSign(s)}
                    className={[
                      "w-10 font-mono text-[14px] font-bold transition-colors",
                      sign === s
                        ? s === "+" ? "bg-emerald-700/40 text-emerald-300" : "bg-orange-700/30 text-orange-300"
                        : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <Input
                id="adj-qty" type="number" min={0} step="any"
                value={qtyStr} onChange={(e) => { setQtyStr(e.target.value); setError(null); }}
                placeholder="0"
                mono className="flex-1 text-right text-[14px]"
                onFocus={(e) => e.target.select()}
                autoFocus
              />
            </div>
          ) : (
            <Input
              id="adj-qty" type="number" min={0} step="any"
              value={qtyStr} onChange={(e) => { setQtyStr(e.target.value); setError(null); }}
              placeholder={numFmt.format(currentStock)}
              mono className="text-right text-[14px]"
              onFocus={(e) => e.target.select()}
              autoFocus
            />
          )}

          {/* Live preview */}
          {qtyValid && delta !== null ? (
            <div className={[
              "flex items-center justify-between rounded-sm border px-3 py-2",
              delta === 0 ? "border-steel-700 bg-steel-900/40"
                : delta > 0 ? "border-emerald-700/40 bg-emerald-900/10"
                : (qtyAfter ?? -1) < 0 ? "border-red-700/40 bg-red-900/10"
                : "border-orange-700/40 bg-orange-900/10",
            ].join(" ")}>
              <span className="font-mono text-[11px] text-muted-foreground/70">
                {numFmt.format(currentStock)} {row.unit} →
              </span>
              <span className={[
                "font-mono text-[13px] font-bold tabular-nums",
                delta === 0 ? "text-muted-foreground"
                  : (qtyAfter ?? -1) < 0 ? "text-red-400"
                  : delta > 0 ? "text-emerald-400"
                  : "text-orange-400",
              ].join(" ")}>
                {qtyAfter !== null ? numFmt.format(qtyAfter) : "—"} {row.unit}
                {delta !== 0 ? (
                  <span className="ml-1.5 text-[10px] font-normal opacity-70">
                    ({delta > 0 ? "+" : ""}{numFmt.format(delta)})
                  </span>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>

        {/* Reason */}
        <div className="space-y-1.5">
          <Label required>Motivo</Label>
          <div className="flex flex-wrap gap-1.5">
            {REASON_PRESETS.map((p) => (
              <button
                key={p} type="button"
                onClick={() => setReasonPreset(p)}
                className={[
                  "rounded-sm border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
                  reasonPreset === p
                    ? "border-safety-500 bg-safety-500/10 text-safety-500"
                    : "border-steel-700 bg-steel-900/40 text-muted-foreground hover:border-steel-600 hover:text-foreground",
                ].join(" ")}
              >
                {p}
              </button>
            ))}
          </div>
          {reasonPreset === "Otro" ? (
            <Input
              type="text" maxLength={120}
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Describe el motivo del ajuste…"
              mono className="mt-1"
              autoFocus
            />
          ) : null}
        </div>

        {/* Note */}
        <div className="space-y-1.5">
          <Label htmlFor="adj-note">
            Nota interna{" "}
            <span className="font-normal normal-case tracking-normal text-muted-foreground/60">(opcional)</span>
          </Label>
          <textarea
            id="adj-note"
            value={note} onChange={(e) => setNote(e.target.value)}
            maxLength={400} rows={2}
            placeholder="Información adicional para el registro…"
            className="w-full resize-none rounded-sm border border-steel-700 bg-steel-900 px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:border-safety-500 focus:outline-none"
          />
        </div>

        {/* Cost override */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setOverrideCost((v) => !v)}
            className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60 hover:text-muted-foreground"
          >
            <span className={[
              "inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border",
              overrideCost ? "border-safety-500 bg-safety-500/20" : "border-steel-600",
            ].join(" ")}>
              {overrideCost ? <span className="h-1.5 w-1.5 rounded-sm bg-safety-500" /> : null}
            </span>
            Especificar costo unitario manualmente
          </button>
          {!overrideCost ? (
            <p className="font-mono text-[10px] text-muted-foreground/50">
              Se usará el CPP actual: {moneyFmt.format(avgCost)} / {row.unit}
            </p>
          ) : (
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold text-muted-foreground/60">$</span>
              <Input
                type="number" min={0} step="0.0001"
                value={costStr} onChange={(e) => setCostStr(e.target.value)}
                placeholder={avgCost.toFixed(4)}
                mono className="pl-7 text-right"
                onFocus={(e) => e.target.select()}
              />
            </div>
          )}
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}
      </div>

      <div className="flex justify-end gap-3 border-t-2 border-steel-700 bg-steel-900/60 px-6 py-4">
        <Button variant="outline" size="md" onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button size="md" loading={submitting} disabled={!canSave} onClick={handleSave}>
          Registrar ajuste
        </Button>
      </div>
    </Dialog>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StockCard({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-sm border border-steel-700 bg-steel-900/40 px-3 py-2.5 text-center">
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground/60">{label}</p>
      <p className="mt-0.5 font-mono text-[14px] font-bold tabular-nums text-foreground">{value}</p>
      {unit ? <p className="font-mono text-[9px] text-muted-foreground/50">{unit}</p> : null}
    </div>
  );
}
