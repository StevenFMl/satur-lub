import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "active" | "warning" | "danger" | "info" | "rust";

const tones: Record<Tone, string> = {
  neutral: "border-steel-600 bg-steel-800 text-muted-foreground",
  active: "border-emerald-700/60 bg-emerald-900/30 text-emerald-300",
  warning: "border-safety-600/60 bg-safety-700/15 text-safety-300",
  danger: "border-hazard-600/60 bg-hazard-700/15 text-red-300",
  info: "border-mechanic-600/60 bg-mechanic-700/15 text-mechanic-400",
  rust: "border-rust-600/60 bg-rust-700/15 text-rust-400",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5",
        "font-mono text-[10px] font-bold uppercase tracking-[0.14em]",
        tones[tone],
        className
      )}
      {...rest}
    />
  );
}
