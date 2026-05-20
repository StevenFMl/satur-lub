"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { getHeldCarts, discardHeldCart, resumeHeldCart, type HeldCart } from "@/actions/holds";
import type { CartLine } from "@/lib/domain/pos-math";
import type { PickedCustomer } from "@/actions/customers";

// ── Formatters ─────────────────────────────────────────────────────────────

const moneyFmt = new Intl.NumberFormat("es-EC", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
});

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "ahora mismo";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} d`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function HoldsPanel({
  open,
  currentCartHasItems,
  onClose,
  onResumed,
}: {
  open:                boolean;
  /** If true, warn the cashier before replacing the active cart. */
  currentCartHasItems: boolean;
  onClose:             () => void;
  /** Called with the resumed cart+customer after the hold is deleted. */
  onResumed:           (cart: CartLine[], customer: PickedCustomer | null) => void;
}) {
  const [holds, setHolds]             = React.useState<HeldCart[]>([]);
  const [loading, setLoading]         = React.useState(false);
  const [busy, setBusy]               = React.useState<string | null>(null); // hold id in flight
  const [confirmId, setConfirmId]     = React.useState<string | null>(null); // id awaiting resume-confirm
  const [error, setError]             = React.useState<string | null>(null);

  // Fetch holds whenever the panel opens
  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    getHeldCarts()
      .then(setHolds)
      .catch(() => setError("Error al cargar ventas aparcadas"))
      .finally(() => setLoading(false));
  }, [open]);

  async function handleResume(id: string) {
    // If the active cart has items, ask for confirmation first
    if (currentCartHasItems && confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    setBusy(id);
    setError(null);
    const result = await resumeHeldCart(id);
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setHolds((prev) => prev.filter((h) => h.id !== id));
    onResumed(result.cart ?? [], result.customer ?? null);
    onClose();
  }

  async function handleDiscard(id: string) {
    setBusy(id);
    setError(null);
    const err = await discardHeldCart(id);
    setBusy(null);
    if (err) { setError(err); return; }
    setHolds((prev) => prev.filter((h) => h.id !== id));
  }

  return (
    <Dialog open={open} onClose={onClose} title="Ventas aparcadas">
      <div className="space-y-3 p-4">
        {error ? (
          <p className="rounded-sm border border-hazard-500/30 bg-hazard-500/5 px-3 py-2 font-mono text-[11px] text-hazard-400">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <SpinnerIcon className="h-5 w-5 animate-spin text-muted-foreground/40" />
          </div>
        ) : holds.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <PauseIcon className="h-8 w-8 text-muted-foreground/25" />
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/50">
              Sin ventas aparcadas
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {holds.map((hold) => {
              const isBusy       = busy === hold.id;
              const needsConfirm = confirmId === hold.id;
              const custName     = hold.customer_snapshot?.full_name ?? "Sin cliente";

              return (
                <li
                  key={hold.id}
                  className="rounded-sm border border-steel-700 bg-steel-900/60 p-3 space-y-2"
                >
                  {/* Hold info */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-semibold text-foreground">
                          {custName}
                        </span>
                        <span className="shrink-0 font-display text-[13px] text-safety-500">
                          {moneyFmt.format(Number(hold.gross_amount))}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/60">
                        <span>{hold.items_count} ítem{hold.items_count !== 1 ? "s" : ""}</span>
                        <span>·</span>
                        <span>{timeAgo(hold.created_at)}</span>
                        {hold.created_by_name ? (
                          <>
                            <span>·</span>
                            <span className="truncate max-w-[80px]">{hold.created_by_name}</span>
                          </>
                        ) : null}
                      </div>
                      {hold.note ? (
                        <p className="font-mono text-[10px] text-muted-foreground/50 italic truncate">
                          {hold.note}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* Confirmation warning */}
                  {needsConfirm ? (
                    <p className="rounded-sm border border-hazard-500/30 bg-hazard-500/5 px-2.5 py-1.5 font-mono text-[10px] text-hazard-400">
                      El carrito actual tiene ítems y será reemplazado. ¿Continuar?
                    </p>
                  ) : null}

                  {/* Action buttons */}
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleResume(hold.id)}
                      disabled={isBusy}
                      className="flex-1 h-7 rounded-sm border border-safety-500 bg-safety-500/10 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-safety-500 transition-colors hover:bg-safety-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isBusy ? (
                        <SpinnerIcon className="mx-auto h-3 w-3 animate-spin" />
                      ) : needsConfirm ? "Confirmar" : "Retomar"}
                    </button>
                    {needsConfirm ? (
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="h-7 px-3 rounded-sm border border-steel-700 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Cancelar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDiscard(hold.id)}
                        disabled={isBusy}
                        className="h-7 px-3 rounded-sm border border-hazard-500/30 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-hazard-500/60 hover:text-hazard-500 disabled:opacity-40"
                      >
                        Descartar
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function PauseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}
