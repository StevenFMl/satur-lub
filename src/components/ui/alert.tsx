import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "info" | "error" | "success" | "warning";

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
}

const toneClasses: Record<Tone, string> = {
  info: "border-mechanic-600/60 bg-mechanic-700/15 text-mechanic-400",
  error: "border-hazard-500/60 bg-hazard-700/15 text-red-300",
  success: "border-signal-600/60 bg-signal-700/20 text-emerald-300",
  warning: "border-safety-600/60 bg-safety-700/15 text-safety-300",
};

const icons: Record<Tone, React.ReactNode> = {
  info: <Icon kind="info" />,
  error: <Icon kind="error" />,
  success: <Icon kind="success" />,
  warning: <Icon kind="warning" />,
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
        "flex items-start gap-3 rounded-sm border-l-4 border-y border-r px-3 py-3",
        "text-[13px] leading-5 font-medium",
        toneClasses[tone],
        className
      )}
      {...props}
    >
      {icons[tone]}
      <div className="min-w-0 flex-1 pt-px">{children}</div>
    </div>
  );
}

function Icon({
  kind,
}: {
  kind: "info" | "error" | "success" | "warning";
}) {
  const stroke = "currentColor";
  const props = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 2.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "mt-0.5 h-5 w-5 shrink-0",
    "aria-hidden": true,
  };
  if (kind === "error" || kind === "warning") {
    return (
      <svg {...props}>
        <path d="M12 3 2 21h20L12 3z" />
        <path d="M12 10v5" />
        <path d="M12 18h.01" />
      </svg>
    );
  }
  if (kind === "success") {
    return (
      <svg {...props}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
