import { cn } from "@/lib/utils";

export function Logo({
  className,
  showText = true,
  tone = "default",
}: {
  className?: string;
  showText?: boolean;
  tone?: "default" | "safety";
}) {
  const markBg =
    tone === "safety"
      ? "bg-safety-500 text-steel-950 border-black/40"
      : "bg-steel-800 text-safety-500 border-steel-600";

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        aria-hidden
        className={cn(
          "grid h-9 w-9 place-items-center rounded-sm border shadow-industrial-sm",
          markBg
        )}
      >
        {/* Engranaje robusto (placa industrial) */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1" />
        </svg>
      </div>
      {showText ? (
        <div className="leading-tight">
          <span className="block text-[15px] font-extrabold uppercase tracking-wider">
            Saturn<span className="text-safety-500">Lub</span>
          </span>
          <span className="block text-[9px] font-semibold uppercase tracking-industrial text-muted-foreground">
            Heavy-Duty OS
          </span>
        </div>
      ) : null}
    </div>
  );
}
