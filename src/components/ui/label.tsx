import * as React from "react";
import { cn } from "@/lib/utils";

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Marca el campo como requerido visualmente con un asterisco rojo. */
  required?: boolean;
}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(
        "industrial-label",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden className="req-mark">
          *
        </span>
      ) : null}
    </label>
  )
);
Label.displayName = "Label";
