"use client";

import * as React from "react";
import { PRICE_OVERRIDE_LABELS, type PriceOverrideType } from "@/lib/validations/sale";
import { applyPctDiscount, type CartLine, type OverridePayload } from "@/lib/domain/pos-math";

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

const OVERRIDE_OPTIONS = (
  Object.entries(PRICE_OVERRIDE_LABELS) as [PriceOverrideType, string][]
).map(([value, label]) => ({ value, label }));

export function OverrideEditor({
  line,
  onSave,
  onClear,
  onCancel,
}: {
  line:     CartLine;
  onSave:   (payload: OverridePayload) => void;
  onClear:  () => void;
  onCancel: () => void;
}) {
  const effective = line.override_unit_price ?? line.unit_price;
  const [inputMode, setInputMode] = React.useState<"price" | "pct">("price");
  const [priceStr, setPriceStr]   = React.useState(effective.toFixed(2));
  const [pctStr, setPctStr]       = React.useState(
    line.override_unit_price != null && line.unit_price > 0
      ? (100 * (1 - line.override_unit_price / line.unit_price)).toFixed(1)
      : ""
  );
  const [type, setType]     = React.useState<string>(line.price_override_type ?? "price_set");
  const [reason, setReason] = React.useState<string>(
    line.price_override_reason ??
    PRICE_OVERRIDE_LABELS[(line.price_override_type ?? "price_set") as PriceOverrideType] ??
    ""
  );
  const [note, setNote] = React.useState<string>(line.price_override_note ?? "");

  const priceNum   = parseFloat(priceStr.replace(",", "."));
  const pctNum     = parseFloat(pctStr.replace(",", "."));
  const pctValid   = isFinite(pctNum) && pctNum >= 0 && pctNum <= 100;
  const priceValid = isFinite(priceNum) && priceNum >= 0;

  const effectivePriceNum = inputMode === "pct" && pctValid
    ? applyPctDiscount(line.unit_price, pctNum)
    : priceNum;
  const effectivePriceValid = inputMode === "pct" ? pctValid : priceValid;
  const canSave = effectivePriceValid && reason.trim().length > 0;

  const discountPct =
    effectivePriceValid && line.unit_price > 0 && effectivePriceNum < line.unit_price
      ? (100 * (1 - effectivePriceNum / line.unit_price))
      : null;

  const handleTypeChange = (val: string) => {
    setType(val);
    const label = PRICE_OVERRIDE_LABELS[val as PriceOverrideType] ?? "";
    if (!reason.trim() || OVERRIDE_OPTIONS.some((o) => o.label === reason)) {
      setReason(label);
    }
  };

  return (
    <div className="mt-2.5 space-y-2 rounded-sm border border-steel-700/80 bg-steel-950/70 p-2.5">
      {/* Mode toggle: Precio / % */}
      <div className="flex overflow-hidden rounded-sm border border-steel-700">
        {(["price", "pct"] as const).map((m) => (
          <button
            key={m} type="button"
            onClick={() => setInputMode(m)}
            className={[
              "flex-1 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] transition-colors",
              inputMode === m ? "bg-steel-700 text-foreground" : "text-muted-foreground/60 hover:text-muted-foreground",
            ].join(" ")}
          >
            {m === "price" ? "Precio $" : "Descuento %"}
          </button>
        ))}
      </div>

      {/* Price input */}
      <div className="space-y-0.5">
        <label className="block font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
          {inputMode === "price" ? "Precio ajustado (USD)" : "Descuento (%)"}
        </label>
        {inputMode === "pct" ? (
          <>
            <div className="relative">
              <input
                type="number" min={0} max={100} step="any"
                value={pctStr}
                onChange={(e) => setPctStr(e.target.value)}
                onFocus={(e) => e.target.select()}
                autoFocus
                className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 pr-8 pl-2.5 text-right font-mono text-[13px] tabular-nums text-foreground focus:border-safety-500 focus:outline-none"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold text-muted-foreground/60">%</span>
            </div>
            {pctValid && line.unit_price > 0 ? (
              <p className="font-mono text-[10px] text-signal-400">
                Precio resultante: {moneyFmt.format(effectivePriceNum)} (−{pctNum.toFixed(1)}%)
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] font-bold text-muted-foreground/60">$</span>
              <input
                type="number" min={0} step="any"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
                onFocus={(e) => e.target.select()}
                autoFocus
                className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 pl-6 pr-2 text-right font-mono text-[13px] tabular-nums text-foreground focus:border-safety-500 focus:outline-none"
              />
            </div>
            {discountPct !== null ? (
              <p className="font-mono text-[10px] text-signal-400">
                −{discountPct.toFixed(1)}% del precio de lista
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Type select */}
      <div className="space-y-0.5">
        <label className="block font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
          Categoría
        </label>
        <select
          value={type}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 px-2 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
        >
          {OVERRIDE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Reason */}
      <div className="space-y-0.5">
        <label className="block font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
          Motivo <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="Descripción del ajuste..."
          className="h-8 w-full rounded-sm border border-steel-700 bg-steel-900 px-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:border-safety-500 focus:outline-none"
        />
      </div>

      {/* Note (optional) */}
      <div className="space-y-0.5">
        <label className="block font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/60">
          Nota interna <span className="text-muted-foreground/40">(opcional)</span>
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Para registros internos..."
          className="w-full resize-none rounded-sm border border-steel-700 bg-steel-900 px-2.5 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:border-safety-500 focus:outline-none"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() =>
            canSave &&
            onSave({
              override_unit_price:   effectivePriceNum,
              price_override_type:   type || null,
              price_override_reason: reason.trim(),
              price_override_note:   note.trim() || null,
            })
          }
          disabled={!canSave}
          className="flex-1 h-7 rounded-sm border border-safety-500 bg-safety-500/10 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-safety-500 transition-colors hover:bg-safety-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Guardar
        </button>
        {line.override_unit_price != null ? (
          <button
            type="button"
            onClick={onClear}
            className="flex-1 h-7 rounded-sm border border-hazard-500/40 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-hazard-500/60 hover:text-hazard-500"
          >
            Quitar
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-7 rounded-sm border border-steel-700 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
