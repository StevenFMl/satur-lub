/**
 * usePosKeyboard — global keyboard shortcuts for the POS terminal.
 *
 * Shortcuts:
 *   F4      — focus + select the search input (always)
 *   F8      — open checkout (when canCheckout=true and no checkout is open)
 *   Delete  — remove the last cart item (when focus is outside an input)
 *
 * The listener is registered once and never re-registered.
 * All mutable state is read through refs to avoid stale closures.
 */

import * as React from "react";

export function usePosKeyboard({
  searchInputRef,
  canCheckout,
  checkoutOpen,
  onOpenCheckout,
  onDeleteLast,
}: {
  /** Ref to the search <input> so F4 can focus it. */
  searchInputRef:  React.RefObject<HTMLInputElement | null>;
  /** Whether F8 should trigger checkout (pre-computed by the caller). */
  canCheckout:     boolean;
  /** Whether the checkout dialog is already open (prevents re-triggering). */
  checkoutOpen:    boolean;
  /** Called when F8 fires and checkout is allowed. */
  onOpenCheckout:  () => void;
  /** Called when Delete fires outside an input — removes the last cart line. */
  onDeleteLast:    () => void;
}): void {
  // Sync latest prop values into refs so the stable listener reads them.
  const canCheckoutRef    = React.useRef(canCheckout);
  const checkoutOpenRef   = React.useRef(checkoutOpen);
  const onOpenCheckoutRef = React.useRef(onOpenCheckout);
  const onDeleteLastRef   = React.useRef(onDeleteLast);

  canCheckoutRef.current    = canCheckout;
  checkoutOpenRef.current   = checkoutOpen;
  onOpenCheckoutRef.current = onOpenCheckout;
  onDeleteLastRef.current   = onDeleteLast;

  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag     = (e.target as HTMLElement).tagName;
      const inInput =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement).contentEditable === "true";

      // F4: focus search input from anywhere
      if (e.key === "F4") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // F8: open checkout — blocked inside inputs to avoid interfering with typing
      if (e.key === "F8" && !inInput && canCheckoutRef.current && !checkoutOpenRef.current) {
        e.preventDefault();
        onOpenCheckoutRef.current();
        return;
      }

      // Delete: remove last cart line — blocked inside inputs
      if (e.key === "Delete" && !inInput) {
        onDeleteLastRef.current();
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // intentionally empty — reads state via refs
}
