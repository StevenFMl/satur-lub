/**
 * POS persistent store — cart + customer only.
 *
 * sessionStorage (not localStorage): survives same-tab navigation but is
 * automatically cleared when the tab is closed. This is intentional — each
 * cashier session starts fresh and cart state should not bleed across shifts.
 *
 * skipHydration: true — avoids a server/client mismatch. The component calls
 * usePosStore.persist.rehydrate() inside a useEffect so the first render is
 * identical to the SSR render (empty state), then hydrates after mount.
 *
 * The store only coordinates state. All calculations stay in pos-math.ts.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { applyPctDiscount, type CartLine, type OverridePayload } from "@/lib/domain/pos-math";
import type { PickedCustomer } from "@/actions/customers";

// ── Types ──────────────────────────────────────────────────────────────────

type PosState = {
  cart:     CartLine[];
  customer: PickedCustomer | null;
};

type PosActions = {
  /** Add a fully-built CartLine. If the key already exists, increments qty by 1. */
  addToCart:           (line: CartLine) => void;
  removeFromCart:      (key: string) => void;
  setQty:              (key: string, qty: number) => void;
  applyOverride:       (key: string, payload: OverridePayload | null) => void;
  /**
   * Replace the entire cart and customer atomically.
   * Used when resuming a held cart so the active session is swapped in one shot.
   */
  replaceCart:         (lines: CartLine[], customer: PickedCustomer | null) => void;
  /** Set every cart line to price 0 (courtesy) with the given reason. */
  applyCourtesy:       (reason: string) => void;
  /** Apply a percentage discount to every cart line via applyPctDiscount. */
  applyGlobalDiscount: (pct: number) => void;
  clearCart:           () => void;
  setCustomer:         (customer: PickedCustomer | null) => void;
  clearCustomer:       () => void;
};

export type PosStore = PosState & PosActions;

// ── Store ──────────────────────────────────────────────────────────────────

export const usePosStore = create<PosStore>()(
  persist(
    (set) => ({
      // ── Initial state ──────────────────────────────────
      cart:     [],
      customer: null,

      // ── Cart actions ───────────────────────────────────
      addToCart: (line) =>
        set((state) => {
          const idx = state.cart.findIndex((l) => l.key === line.key);
          if (idx >= 0) {
            const updated  = [...state.cart];
            updated[idx]   = { ...updated[idx]!, quantity: updated[idx]!.quantity + 1 };
            return { cart: updated };
          }
          return { cart: [...state.cart, line] };
        }),

      removeFromCart: (key) =>
        set((state) => ({ cart: state.cart.filter((l) => l.key !== key) })),

      setQty: (key, qty) =>
        set((state) => ({
          cart: qty <= 0
            ? state.cart.filter((l) => l.key !== key)
            : state.cart.map((l) => (l.key === key ? { ...l, quantity: qty } : l)),
        })),

      applyOverride: (key, payload) =>
        set((state) => ({
          cart: state.cart.map((l) =>
            l.key !== key
              ? l
              : {
                  ...l,
                  override_unit_price:   payload?.override_unit_price   ?? null,
                  price_override_type:   payload?.price_override_type   ?? null,
                  price_override_reason: payload?.price_override_reason ?? null,
                  price_override_note:   payload?.price_override_note   ?? null,
                }
          ),
        })),

      applyCourtesy: (reason) =>
        set((state) => ({
          cart: state.cart.map((l) => ({
            ...l,
            override_unit_price:   0,
            price_override_type:   "courtesy" as const,
            price_override_reason: reason,
            price_override_note:   null,
          })),
        })),

      applyGlobalDiscount: (pct) =>
        set((state) => ({
          cart: state.cart.map((l) => ({
            ...l,
            override_unit_price:   applyPctDiscount(l.unit_price, pct),
            price_override_type:   "price_set" as const,
            price_override_reason: `Descuento ${pct}%`,
            price_override_note:   null,
          })),
        })),

      replaceCart: (lines, customer) => set({ cart: lines, customer }),

      clearCart: () => set({ cart: [] }),

      // ── Customer actions ───────────────────────────────
      setCustomer:   (customer) => set({ customer }),
      clearCustomer: ()         => set({ customer: null }),
    }),
    {
      name: "satur-lub-pos",
      storage: createJSONStorage(() => sessionStorage),
      // Only persist cart + customer; skip ephemeral UI state.
      partialize: (state): PosState => ({ cart: state.cart, customer: state.customer }),
      // Defer hydration to a useEffect in the component to avoid SSR mismatch.
      skipHydration: true,
    }
  )
);
