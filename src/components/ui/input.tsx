import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /**
   * Activa tipografía monoespaciada (JetBrains Mono).
   * Usar en datos duros: cédulas, RUC, placas, slugs, valores monetarios.
   */
  mono?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", invalid, mono, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || undefined}
        className={cn(
          // Tamaño POS: 48px de alto, fácil de tocar con guantes
          "flex h-12 w-full rounded-sm bg-steel-950 px-4 py-2",
          // Tipografía: sans para texto general, mono para datos duros
          mono
            ? "font-mono text-[14.5px] tracking-[0.02em] tabular-nums"
            : "text-[15px] font-medium",
          "text-foreground",
          // Borde + estados
          "border-2",
          invalid ? "border-hazard-500/70" : "border-steel-700",
          "placeholder:text-muted-foreground placeholder:font-normal placeholder:tracking-normal",
          "shadow-control-inset",
          // Transición fluida tipo enterprise
          "transition-all duration-150 ease-out",
          "hover:border-steel-500",
          // Focus ring tipo Stripe/Apple: borde nítido + halo separado
          "focus:outline-none",
          "focus-visible:outline-none",
          invalid
            ? "focus-visible:border-hazard-500 focus-visible:ring-2 focus-visible:ring-hazard-500/45"
            : "focus-visible:border-safety-500 focus-visible:ring-2 focus-visible:ring-safety-500/45",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
