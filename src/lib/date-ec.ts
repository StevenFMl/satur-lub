/**
 * Ecuador business-date utilities.
 *
 * The server runs in UTC. Ecuador is UTC-5. After 19:00 local time the UTC
 * clock has already rolled to the next calendar day, so plain `new Date()`
 * on the server returns tomorrow's date. Every business-date calculation
 * must pin to America/Guayaquil — these helpers do it consistently.
 *
 * All functions work on both server (Node.js) and client (browser) because
 * they rely on Intl.DateTimeFormat with an explicit timeZone, not on the
 * runtime's default timezone.
 */

const TZ = "America/Guayaquil";

/** Today as YYYY-MM-DD in Ecuador local time. */
export function todayEC(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/**
 * Long-form label for today in Spanish, Ecuador timezone.
 * Example: "Jueves, 14 de mayo"
 */
export function todayLabelEC(): string {
  const raw = new Intl.DateTimeFormat("es-EC", {
    timeZone: TZ,
    weekday: "long",
    day:     "numeric",
    month:   "long",
  }).format(new Date());
  return raw.replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Clamp a YYYY-MM-DD string to never exceed today in Ecuador timezone.
 * Used on searchParams from URLs that could carry a future date.
 */
export function clampToTodayEC(date: string): string {
  const today = todayEC();
  return date > today ? today : date;
}

/**
 * Format any Date or ISO timestamp for display in es-EC, pinned to
 * America/Guayaquil so records near midnight show the correct local day.
 *
 * For date-only strings (YYYY-MM-DD) pass them directly — we inject T12:00:00
 * before parsing so UTC-midnight never crosses into the previous local day.
 */
export function formatDateEC(value: string | Date): string {
  let d: Date;
  if (typeof value === "string") {
    // Date-only string: "2026-05-14" → treat as noon UTC to avoid midnight TZ shift.
    d = value.length === 10
      ? new Date(value + "T12:00:00Z")
      : new Date(value);
  } else {
    d = value;
  }
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: TZ,
    day:      "2-digit",
    month:    "short",
    year:     "numeric",
  }).format(d);
}
