import { cn } from "@/lib/utils";

/**
 * SaturnLub mark = anillo de Saturno + gota de aceite.
 * "Saturn" = el planeta con el anillo  ·  "Lub" = la gota de lubricante.
 * Identidad propia, automotriz y reconocible incluso al pequeño tamaño.
 */
export function Logo({
  className,
  showText = true,
  tone = "default",
  size = "md",
}: {
  className?: string;
  showText?: boolean;
  tone?: "default" | "safety";
  size?: "sm" | "md" | "lg";
}) {
  const markSize =
    size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const titleSize =
    size === "sm"
      ? "text-[14px]"
      : size === "lg"
        ? "text-[20px]"
        : "text-[16px]";

  const ringColor = tone === "safety" ? "#080B10" : "#FFC107";
  const dropColor = tone === "safety" ? "#080B10" : "#F2F4F7";
  const markBg =
    tone === "safety"
      ? "bg-safety-500 border-black/40"
      : "bg-steel-900 border-steel-700";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        aria-hidden
        className={cn(
          "relative grid place-items-center rounded-sm border shadow-bevel-sm",
          "metal-gradient overflow-hidden",
          markSize,
          markBg
        )}
      >
        <svg
          viewBox="0 0 32 32"
          className="h-[70%] w-[70%]"
          fill="none"
        >
          {/* Anillo de Saturno (elipse inclinada) */}
          <ellipse
            cx="16"
            cy="16"
            rx="14"
            ry="4.2"
            transform="rotate(-22 16 16)"
            stroke={ringColor}
            strokeWidth="1.6"
            opacity="0.85"
          />
          {/* Gota de aceite (cuerpo del planeta-gota) */}
          <path
            d="M16 6.5
               C 19.6 11, 22 14, 22 17.6
               A 6 6 0 0 1 10 17.6
               C 10 14, 12.4 11, 16 6.5 Z"
            fill={dropColor}
          />
          {/* Highlight en la gota */}
          <path
            d="M14 12.5 C 13 14.5 12.5 16 12.5 17.6"
            stroke={tone === "safety" ? "#FFC107" : "#FFFFFF"}
            strokeOpacity={tone === "safety" ? 0.4 : 0.55}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {showText ? (
        <div className="leading-none">
          <span
            className={cn(
              "block font-display tracking-[0.04em]",
              titleSize
            )}
          >
            <span className="text-foreground">SATURN</span>
            <span className="text-safety-500">LUB</span>
          </span>
          <span className="mt-1 block font-mono text-[9px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            Heavy-Duty&nbsp;OS
          </span>
        </div>
      ) : null}
    </div>
  );
}
