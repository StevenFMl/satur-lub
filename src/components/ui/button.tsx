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
    "bg-primary text-primary-foreground border border-black/40",
    "hover:bg-safety-400 active:bg-safety-600",
    "shadow-industrial active:shadow-industrial-pressed",
    "active:translate-y-[2px]"
  ),
  secondary: cn(
    "bg-steel-700 text-foreground border border-steel-600",
    "hover:bg-steel-600 active:bg-steel-800",
    "shadow-industrial-sm active:shadow-industrial-pressed",
    "active:translate-y-[1px]"
  ),
  outline: cn(
    "bg-transparent text-foreground border-2 border-steel-600",
    "hover:bg-steel-800 hover:border-steel-500",
    "active:bg-steel-900"
  ),
  ghost: "bg-transparent text-foreground hover:bg-steel-800",
  danger: cn(
    "bg-destructive text-destructive-foreground border border-black/40",
    "hover:bg-hazard-600 active:bg-hazard-700",
    "shadow-industrial active:shadow-industrial-pressed",
    "active:translate-y-[2px]"
  ),
  rust: cn(
    "bg-rust-500 text-white border border-black/40",
    "hover:bg-rust-400 active:bg-rust-600",
    "shadow-industrial active:shadow-industrial-pressed",
    "active:translate-y-[2px]"
  ),
};

const sizeClasses: Record<Size, string> = {
  // Pensados para POS / guantes: target táctil grande
  sm: "h-10 px-3.5 text-[12px] tracking-wide rounded-sm",
  md: "h-11 px-4 text-[13px] tracking-wide rounded-sm",
  lg: "h-12 px-5 text-[14px] tracking-wider rounded-sm",
  xl: "h-14 px-6 text-[15px] tracking-wider rounded-sm",
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
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(
          "inline-flex select-none items-center justify-center gap-2",
          "font-bold uppercase",
          "transition-[background-color,transform,box-shadow] duration-100 ease-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {loading ? (
          <span
            aria-hidden
            className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-[2px] border-current border-t-transparent"
          />
        ) : null}
        <span className="truncate">{children}</span>
      </button>
    );
  }
);
Button.displayName = "Button";
