import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function formatDate(value: string | Date): string {
  let d: Date;
  if (typeof value === "string") {
    // Date-only strings (YYYY-MM-DD): parse as noon UTC so EC timezone (UTC-5)
    // never slips back to the previous calendar day.
    d = value.length === 10 ? new Date(value + "T12:00:00Z") : new Date(value);
  } else {
    d = value;
  }
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    day:      "2-digit",
    month:    "short",
    year:     "numeric",
  }).format(d);
}
