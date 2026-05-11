"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * FormDialog — modal centrado en desktop, fullscreen en mobile.
 *
 * Desktop: modal centrado con max-w-xl, max-height 90vh, scroll interno.
 * Mobile:  ocupa toda la pantalla, scroll nativo, touch-friendly.
 *
 * Diseñado para formularios de creación/edición donde el Sheet lateral
 * se queda corto visualmente. El form ocupa el children completo y
 * gestiona su propio footer de acciones.
 */
export function FormDialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: FormDialogProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Cerrar formulario"
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-[3px]"
      />

      {/* Container */}
      <div
        className={cn(
          // Mobile: full screen
          "relative flex w-full flex-col bg-steel-900 overflow-hidden",
          "h-full",
          // Desktop: centered modal with max dimensions
          "sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-sm sm:border-2 sm:border-steel-700 sm:shadow-2xl",
          className
        )}
      >
        {/* Header */}
        {(title || description) && (
          <div className="shrink-0 top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-5 py-4 sm:px-6 sm:py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                {title && (
                  <h2 className="font-display text-[22px] leading-none tracking-[0.04em] text-foreground sm:text-[24px]">
                    {title.toUpperCase()}
                  </h2>
                )}
                {description && (
                  <p className="text-[12.5px] leading-5 text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-steel-700 bg-steel-800 text-muted-foreground transition-colors hover:border-steel-500 hover:bg-steel-700 hover:text-foreground"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Body — el form maneja su propio scroll y footer */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
