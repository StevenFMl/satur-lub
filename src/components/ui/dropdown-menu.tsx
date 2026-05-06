"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Align = "start" | "end";

export interface DropdownMenuProps {
  /** Contenido del trigger (típicamente un ícono de "tres puntos"). */
  trigger?: React.ReactNode;
  triggerAriaLabel?: string;
  align?: Align;
  /**
   * Children pueden ser nodos directos o una función que recibe `close()` —
   * útil para cerrar el menú después de invocar la acción.
   */
  children:
    | React.ReactNode
    | ((close: () => void) => React.ReactNode);
  className?: string;
  disabled?: boolean;
}

export function DropdownMenu({
  trigger,
  triggerAriaLabel = "Abrir menú",
  align = "end",
  children,
  className,
  disabled,
}: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = React.useCallback(() => setOpen(false), []);

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "grid h-9 w-9 place-items-center rounded-sm border border-steel-700 bg-steel-800 text-muted-foreground transition-colors",
          "hover:border-safety-500/60 hover:text-safety-500",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          open && "border-safety-500/60 text-safety-500"
        )}
      >
        {trigger ?? (
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="currentColor"
            aria-hidden
          >
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        )}
      </button>
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute z-40 mt-1 min-w-[180px] overflow-hidden rounded-sm border-2 border-steel-700 bg-steel-900 shadow-2xl",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}

export interface DropdownItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  destructive?: boolean;
}

export function DropdownItem({
  destructive,
  className,
  children,
  ...rest
}: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2.5 text-left font-mono text-[12px] font-bold uppercase tracking-[0.12em] transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        destructive
          ? "text-red-300 hover:bg-hazard-700/25 hover:text-red-200"
          : "text-foreground hover:bg-steel-800",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
