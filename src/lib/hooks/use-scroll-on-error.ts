"use client";

import { useEffect, useRef } from "react";

/**
 * Hace scroll al elemento cuando aparece un mensaje top-level (server error o
 * notice). En mobile, los Alert al final del form quedan fuera de viewport
 * tras el submit — esto los trae al centro y mueve foco para lectores.
 */
export function useScrollOnMessage<T extends HTMLElement = HTMLDivElement>(
  message: string | null | undefined
) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!message || !ref.current) return;
    ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof ref.current.focus === "function") {
      ref.current.focus({ preventScroll: true });
    }
  }, [message]);

  return ref;
}
