import { cn } from "@/lib/utils";

export function Logo({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        aria-hidden
        className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background shadow-sm"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ellipse cx="12" cy="12" rx="10" ry="4" />
          <path d="M2 12c0 2.5 4.5 4.5 10 4.5S22 14.5 22 12" />
          <path d="M12 8v8" />
        </svg>
      </div>
      {showText ? (
        <span className="text-lg font-semibold tracking-tight">
          Saturn<span className="text-muted-foreground">Lub</span>
        </span>
      ) : null}
    </div>
  );
}
