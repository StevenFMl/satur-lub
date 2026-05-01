import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-12 w-full appearance-none rounded-sm bg-steel-950 px-4 py-2",
      "text-[15px] font-medium text-foreground",
      "border-2 border-steel-700",
      "shadow-control-inset",
      "transition-[border-color,box-shadow] duration-100",
      "hover:border-steel-500",
      "focus:outline-none focus:border-safety-500 focus-visible:ring-2 focus-visible:ring-safety-500/40",
      "disabled:cursor-not-allowed disabled:opacity-60",
      "bg-no-repeat bg-[right_0.85rem_center] bg-[length:14px] pr-10",
      "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%23FFC107' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round' viewBox='0 0 24 24'><polyline points='6 9 12 15 18 9'/></svg>\")]",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
