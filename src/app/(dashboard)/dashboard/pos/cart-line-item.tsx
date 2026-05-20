"use client";

import { memo } from "react";
import { lineGross, type CartLine, type OverridePayload } from "@/lib/domain/pos-math";
import type { PosPermissions } from "@/lib/auth/permissions";
import { OverrideEditor } from "./override-editor";

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

// Default shallow comparison is sufficient:
// — unchanged lines keep the same object reference (Zustand's map preserves refs)
// — all callbacks are stable Zustand actions or useState setters
export const CartLineItem = memo(function CartLineItem({
  line,
  isEditing,
  permissions,
  productNameById,
  onSetQty,
  onRemove,
  onOverride,
  onEditToggle,
}: {
  line:            CartLine;
  isEditing:       boolean;
  permissions:     PosPermissions;
  productNameById: Map<string, string>;
  onSetQty:        (key: string, qty: number) => void;
  onRemove:        (key: string) => void;
  onOverride:      (key: string, payload: OverridePayload | null) => void;
  onEditToggle:    (key: string | null) => void;
}) {
  const gross       = Number(lineGross(line).round(2).toString());
  const stockWarn   = (line.track_inventory || (line.is_kit && line.kit_components.length > 0))
                      && line.quantity * line.base_qty > line.stock_base;
  const hasOverride = line.override_unit_price != null;
  // A real discount means the override price is LOWER than the list price.
  // Markups (override > list) must never show a strikethrough or a % badge —
  // showing "~~$20~~ $22" would imply the customer was charged more than normal.
  const effectivePx  = line.override_unit_price ?? line.unit_price;
  const isDiscount   = hasOverride && effectivePx < line.unit_price;
  const discountPct  = isDiscount && line.unit_price > 0
    ? (100 * (1 - effectivePx / line.unit_price))
    : 0;

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-semibold leading-tight text-foreground">
              {line.name}
            </span>
            {line.product_id === null ? (
              <span className="shrink-0 rounded-sm border border-sky-700/50 bg-sky-900/20 px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.08em] text-sky-400/80">
                Manual
              </span>
            ) : null}
            {hasOverride ? (
              line.price_override_type === "combo" ? (
                <span className="shrink-0 rounded-sm border border-emerald-600/50 bg-emerald-700/15 px-1 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] text-emerald-400">
                  COMBO
                </span>
              ) : line.price_override_type === "courtesy" ? (
                <span className="shrink-0 rounded-sm border border-safety-500/40 bg-safety-500/10 px-1 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] text-safety-500">
                  CORT.
                </span>
              ) : isDiscount ? (
                // Only show the % badge for real discounts; markups show nothing.
                <span className="shrink-0 rounded-sm border border-signal-600/50 bg-signal-700/15 px-1 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] text-signal-400">
                  −{discountPct.toFixed(0)}%
                </span>
              ) : null
            ) : null}
          </div>

          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70">
            {isDiscount ? (
              // Real discount: show list price struck through, then the lower final price.
              <>
                <span className="line-through text-muted-foreground/40">
                  {moneyFmt.format(line.unit_price)}
                </span>
                <span className="text-signal-400 font-semibold">
                  {moneyFmt.format(effectivePx)}
                </span>
              </>
            ) : (
              // No override or markup: show only the final charged price — no comparison.
              <span>{moneyFmt.format(effectivePx)}</span>
            )}
            <span>/</span>
            <span>{line.unit_label}</span>
            {line.base_qty !== 1 ? (
              <span className="text-muted-foreground/50">({line.base_qty} u.b.)</span>
            ) : null}
          </div>

          {stockWarn ? (
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-red-400">
              Stock insuficiente
            </div>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-foreground">
          {moneyFmt.format(gross)}
        </span>
      </div>

      {/* Kit/bundle component sub-items — visual only, no fiscal impact */}
      {line.is_kit && line.kit_components.length > 0 ? (
        <ul className="mt-1 space-y-px border-l-2 border-sky-700/40 pl-2">
          {[...line.kit_components]
            .sort((a, b) => a.sort_order - b.sort_order)
            .slice(0, 3)
            .map((c) => {
              const totalQty = c.quantity * c.base_qty;
              const display  = totalQty % 1 === 0 ? String(totalQty) : totalQty.toFixed(2);
              return (
                <li key={c.product_id} className="flex items-center justify-between gap-1.5 min-w-0">
                  <span className="truncate font-mono text-[9px] leading-4 text-muted-foreground/55">
                    {productNameById.get(c.product_id) ?? "—"}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground/40">
                    ×{display}
                  </span>
                </li>
              );
            })}
          {line.kit_components.length > 3 ? (
            <li className="font-mono text-[9px] leading-4 text-muted-foreground/35">
              +{line.kit_components.length - 3} componente{line.kit_components.length - 3 !== 1 ? "s" : ""}
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* Qty controls + override toggle + remove */}
      <div className="mt-2 flex items-center gap-1.5">
        <div className="flex overflow-hidden rounded-sm border border-steel-700">
          <button
            type="button"
            onClick={() => onSetQty(line.key, line.quantity - 1)}
            className="h-7 w-7 grid place-items-center font-bold text-muted-foreground transition-colors hover:bg-steel-800 hover:text-foreground"
            aria-label="Disminuir"
          >
            −
          </button>
          <span className="w-8 border-x border-steel-700/70 text-center font-mono text-[12px] font-bold tabular-nums text-foreground py-1">
            {line.quantity}
          </span>
          <button
            type="button"
            onClick={() => onSetQty(line.key, line.quantity + 1)}
            className="h-7 w-7 grid place-items-center font-bold text-muted-foreground transition-colors hover:bg-steel-800 hover:text-foreground"
            aria-label="Aumentar"
          >
            +
          </button>
        </div>

        <div className="flex-1" />

        {permissions.canEditLinePrice ? (
          hasOverride ? (
            <button
              type="button"
              onClick={() => onEditToggle(isEditing ? null : line.key)}
              title="Editar ajuste de precio"
              className={[
                "flex h-7 items-center gap-1 rounded-sm border px-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.08em] transition-colors",
                isEditing
                  ? "border-signal-500 bg-signal-700/20 text-signal-400"
                  : "border-signal-600/40 bg-signal-700/10 text-signal-400 hover:border-signal-500/60",
              ].join(" ")}
            >
              <PencilIcon className="h-2.5 w-2.5" />
              Ajustado
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onEditToggle(isEditing ? null : line.key)}
              title="Ajustar precio"
              className={[
                "flex h-7 w-7 items-center justify-center rounded-sm border transition-colors",
                isEditing
                  ? "border-safety-500/60 bg-safety-500/10 text-safety-500"
                  : "border-steel-700 text-muted-foreground/50 hover:border-steel-600 hover:text-foreground",
              ].join(" ")}
            >
              <PencilIcon className="h-3 w-3" />
            </button>
          )
        ) : null}

        <button
          type="button"
          onClick={() => onRemove(line.key)}
          className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground/50 transition-colors hover:text-hazard-500"
          aria-label="Quitar"
        >
          <XSmallIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Override editor */}
      {isEditing ? (
        <OverrideEditor
          line={line}
          onSave={(payload) => {
            onOverride(line.key, payload);
            onEditToggle(null);
          }}
          onClear={() => {
            onOverride(line.key, null);
            onEditToggle(null);
          }}
          onCancel={() => onEditToggle(null)}
        />
      ) : null}
    </li>
  );
});

// ── Icons (only used in this component) ───────────────────────────────────

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function XSmallIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18" /><path d="M6 6l12 12" />
    </svg>
  );
}
