"use client";

import { useRouter } from "next/navigation";

function adjDate(d: string, delta: number): string {
  const dt = new Date(d + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function DateNav({ date, today }: { date: string; today: string }) {
  const router  = useRouter();
  const isToday = date === today;

  const go = (d: string) => router.push(`/dashboard/pos/cierre?date=${d}`);

  return (
    <div className="flex items-center gap-2">
      {/* Previous day */}
      <button
        type="button"
        onClick={() => go(adjDate(date, -1))}
        className="flex h-8 w-8 items-center justify-center rounded-sm border border-steel-700 text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
        title="Día anterior"
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </button>

      {/* Date picker */}
      <input
        type="date"
        value={date}
        max={today}
        onChange={(e) => { if (e.target.value) go(e.target.value); }}
        className="flex-1 rounded-sm border border-steel-700 bg-steel-900 px-3 py-1.5 font-mono text-[11px] text-foreground focus:border-safety-500 focus:outline-none"
      />

      {/* Next day */}
      <button
        type="button"
        onClick={() => !isToday && go(adjDate(date, 1))}
        disabled={isToday}
        className="flex h-8 w-8 items-center justify-center rounded-sm border border-steel-700 text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        title="Día siguiente"
      >
        <ChevronRightIcon className="h-4 w-4" />
      </button>

      {/* Go to today */}
      {!isToday ? (
        <button
          type="button"
          onClick={() => router.push("/dashboard/pos/cierre")}
          className="h-8 rounded-sm border border-steel-700 px-3 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-steel-600 hover:text-foreground"
        >
          Hoy
        </button>
      ) : null}
    </div>
  );
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
