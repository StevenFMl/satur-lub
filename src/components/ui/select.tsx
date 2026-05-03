import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, invalid, ...props }, ref) => (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "flex h-12 w-full appearance-none rounded-sm bg-steel-950 px-4 py-2",
        "text-[15px] font-medium text-foreground",
        "border-2",
        invalid ? "border-hazard-500/70" : "border-steel-700",
        "shadow-control-inset",
        "transition-all duration-150 ease-out",
        "hover:border-steel-500",
        "focus:outline-none focus-visible:outline-none",
        invalid
          ? "focus-visible:border-hazard-500 focus-visible:ring-2 focus-visible:ring-hazard-500/45"
          : "focus-visible:border-safety-500 focus-visible:ring-2 focus-visible:ring-safety-500/45",
        "disabled:cursor-not-allowed disabled:opacity-60",
        // Chevron amarillo seguridad embebido
        "bg-no-repeat bg-[right_0.85rem_center] bg-[length:14px] pr-10",
        "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%23FFC107' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' viewBox='0 0 24 24'><polyline points='6 9 12 15 18 9'/></svg>\")]",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = "Select";
