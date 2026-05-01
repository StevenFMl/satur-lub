import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", invalid, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        aria-invalid={invalid || undefined}
        className={cn(
          // Tamaño POS: 48px de alto, fácil de tocar con guantes
          "flex h-12 w-full rounded-sm bg-steel-950 px-4 py-2",
          "text-[15px] font-medium text-foreground",
          "border-2",
          invalid ? "border-hazard-500/70" : "border-steel-700",
          "placeholder:text-muted-foreground placeholder:font-normal",
          "shadow-control-inset",
          "transition-[border-color,box-shadow] duration-100",
          "hover:border-steel-500",
          // Focus = anillo amarillo seguridad
          "focus:outline-none focus:border-safety-500",
          "focus-visible:ring-2 focus-visible:ring-safety-500/40",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
