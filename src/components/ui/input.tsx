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
          "flex h-10 w-full rounded-md border bg-card px-3 py-2 text-[14px] text-foreground",
          "placeholder:text-muted-foreground/80",
          "shadow-[inset_0_1px_0_hsl(220_13%_96%/0.6)]",
          "transition-[box-shadow,border-color,background-color] duration-150",
          invalid
            ? "border-destructive/50"
            : "border-input hover:border-foreground/25",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/10 focus-visible:border-foreground/40",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
