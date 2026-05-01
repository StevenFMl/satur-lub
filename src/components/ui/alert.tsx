import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "info" | "error" | "success";

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
}

const toneClasses: Record<Tone, string> = {
  info: "border-border bg-muted/60 text-foreground",
  error:
    "border-destructive/25 bg-destructive/[0.04] text-destructive",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const icons: Record<Tone, React.ReactNode> = {
  info: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 shrink-0 opacity-80"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  ),
  error: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 shrink-0"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  ),
  success: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 shrink-0"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
};

export function Alert({
  tone = "info",
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] leading-5",
        toneClasses[tone],
        className
      )}
      {...props}
    >
      {icons[tone]}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
