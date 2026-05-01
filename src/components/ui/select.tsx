import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-10 w-full appearance-none rounded-md border border-input bg-card px-3 py-2 text-[14px] text-foreground",
      "shadow-[inset_0_1px_0_hsl(220_13%_96%/0.6)]",
      "transition-[box-shadow,border-color,background-color] duration-150",
      "hover:border-foreground/25",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10 focus-visible:border-foreground/40",
      "disabled:cursor-not-allowed disabled:opacity-60",
      "bg-[length:14px] bg-no-repeat bg-[right_0.85rem_center]",
      "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' viewBox='0 0 24 24'><polyline points='6 9 12 15 18 9'/></svg>\")] pr-9",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
