/**
 * useBarcodeScannerInput — detects physical barcode/QR scanner input.
 *
 * Detection heuristic
 * -------------------
 * A barcode scanner fires keydown events much faster than a human can type.
 * We buffer printable characters that arrive within THRESHOLD_MS of each
 * other.  When Enter arrives as the next event, and the buffer has at least
 * MIN_SCAN_LENGTH characters, we consider it a scan and fire `onScan`.
 *
 * If the gap between any two consecutive keystrokes exceeds THRESHOLD_MS,
 * the buffer is reset — preventing accumulated human keystrokes from being
 * misidentified as a scan.
 *
 * Input element handling
 * ----------------------
 * When focus is inside an INPUT or TEXTAREA (e.g. the search box), this
 * hook returns early.  The input's own `onKeyDown` handler is responsible
 * for the Enter-to-add-to-cart bypass in that case.  This prevents double
 * insertion: the scanner chars go into the input, and the input handles them.
 *
 * Parameters
 * ----------
 * onScan   — called with the scanned code string when a scan is detected.
 * isActive — set to false while modals are open so a scan during checkout
 *            or while a modal is in focus doesn't add unexpected products.
 */

import * as React from "react";

/** Max milliseconds between consecutive scanner keystrokes. */
const THRESHOLD_MS  = 80;
/** Minimum number of characters that constitute a valid scan. */
const MIN_SCAN_LENGTH = 4;

export function useBarcodeScannerInput({
  onScan,
  isActive = true,
}: {
  onScan:    (code: string) => void;
  isActive?: boolean;
}): void {
  const bufferRef    = React.useRef("");
  const lastTimeRef  = React.useRef(0);
  const onScanRef    = React.useRef(onScan);
  const isActiveRef  = React.useRef(isActive);

  // Keep refs current on every render (same pattern as usePosKeyboard)
  onScanRef.current   = onScan;
  isActiveRef.current = isActive;

  React.useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (!isActiveRef.current) return;

      // Delegate to the focused input's own handler — prevents double-add
      // when the search input is focused (it handles Enter-to-cart itself).
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const now = Date.now();

      // Enter = end-of-scan sentinel
      if (e.key === "Enter") {
        const code = bufferRef.current;
        bufferRef.current   = "";
        lastTimeRef.current = 0;

        if (code.length >= MIN_SCAN_LENGTH) {
          e.preventDefault(); // prevent any browser default for Enter outside an input
          onScanRef.current(code);
        }
        return;
      }

      // Long gap since last keystroke → this is a new human typing sequence; reset
      if (lastTimeRef.current > 0 && now - lastTimeRef.current > THRESHOLD_MS) {
        bufferRef.current = "";
      }

      // Only accumulate printable single characters; ignore modifier-only events
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        bufferRef.current  += e.key;
        lastTimeRef.current = now;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // stable listener, reads all state via refs
}
