import * as React from "react";
import { cn } from "@/lib/utils";

type Variant =
  | "primary"   // Amarillo seguridad — CTA principal
  | "secondary" // Acero — acción secundaria
  | "outline"   // Solo borde — terciaria
  | "ghost"     // Sin fondo — utilitaria
  | "danger"    // Rojo hazard — destructiva
  | "rust";     // Naranja óxido — acción operativa

type Size = "sm" | "md" | "lg" | "xl";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary: cn(
    "bg-safety-500 text-steel-950 border border-black/50",
    "hover:bg-safety-400 active:bg-safety-600",
    "shadow-bevel-sm hover:shadow-safety-glow active:shadow-industrial-pressed",
    "active:translate-y-[2px]"
  ),
  secondary: cn(
    "bg-steel-700 text-foreground border border-steel-600",
    "hover:bg-steel-600 active:bg-steel-800",
    "shadow-bevel-sm active:shadow-industrial-pressed",
    "active:translate-y-[1px]"
  ),
  outline: cn(
    "bg-transparent text-foreground border-2 border-steel-600",
    "hover:bg-steel-800 hover:border-steel-500 hover:text-safety-500",
    "active:bg-steel-900"
  ),
  ghost:
    "bg-transparent text-muted-foreground hover:bg-steel-800 hover:text-foreground",
  danger: cn(
    "bg-destructive text-destructive-foreground border border-black/50",
    "hover:bg-hazard-600 active:bg-hazard-700",
    "shadow-bevel-sm active:shadow-industrial-pressed",
    "active:translate-y-[2px]"
  ),
  rust: cn(
    "bg-rust-500 text-white border border-black/50",
    "hover:bg-rust-400 active:bg-rust-600",
    "shadow-bevel-sm active:shadow-industrial-pressed",
    "active:translate-y-[2px]"
  ),
};

const sizeClasses: Record<Size, string> = {
  // Pensados para POS / guantes: target táctil grande
  sm: "h-10 px-4 text-[12px] tracking-wider rounded-sm",
  md: "h-11 px-5 text-[13px] tracking-wider rounded-sm",
  lg: "h-12 px-6 text-[14px] tracking-[0.14em] rounded-sm",
  xl: "h-14 px-7 text-[15px] tracking-[0.16em] rounded-sm",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const showMetalOverlay =
      variant !== "ghost" && variant !== "outline";

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "group/btn relative inline-flex select-none items-center justify-center gap-2 overflow-hidden",
          "font-semibold uppercase whitespace-nowrap",
          "transition-all duration-150 ease-out",
          // Focus ring nítido estilo Apple/Stripe: ring sólido + offset desde fondo
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {/* Highlight metálico superior — sutil, da volumen */}
        {showMetalOverlay ? (
          <span
            aria-hidden
            className="metal-gradient pointer-events-none absolute inset-0"
          />
        ) : null}

        <span className="relative inline-flex items-center gap-2">
          {loading ? (
            <span
              aria-hidden
              className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-[2px] border-current border-t-transparent"
            />
          ) : null}
          <span className="truncate">{children}</span>
        </span>
      </button>
    );
  }
);
Button.displayName = "Button";
