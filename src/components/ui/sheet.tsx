"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  side?: "right" | "left";
  children: React.ReactNode;
  className?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  side = "right",
  children,
  className,
}: SheetProps) {
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

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Cerrar panel"
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
      />
      <div
        className={cn(
          "relative flex h-full w-full max-w-md flex-col border-steel-700 bg-steel-900 shadow-2xl",
          side === "right" ? "ml-auto border-l-2" : "mr-auto border-r-2",
          className
        )}
      >
        {(title || description) && (
          <div className="top-highlight border-b-2 border-steel-700 bg-steel-900/70 px-6 py-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                {title && (
                  <h2 className="font-display text-[20px] leading-none tracking-[0.04em] text-foreground">
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
                className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-steel-700 bg-steel-800 text-muted-foreground transition-colors hover:border-steel-500 hover:bg-steel-700 hover:text-foreground"
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
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
