// Date helpers. Dates travel as ISO "YYYY-MM-DD" strings, exactly as the API uses them.
// These only format and navigate; working-day counting is done by the API (/leave-requests/preview).

export const BUSINESS_TIMEZONE = "Asia/Dubai";

/** Today's date in the business timezone, matching the API's notion of "today". */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE }).format(now);
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export const formatDate = (iso: string) => dayFmt.format(parseISO(iso));
export const formatMonth = (iso: string) => monthFmt.format(parseISO(iso));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

export function formatRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${sameYear ? shortFmt.format(parseISO(start)) : formatDate(start)} – ${formatDate(end)}`;
}

export function monthBounds(iso: string): { start: string; end: string } {
  const d = parseISO(iso);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { start: toISO(start), end: toISO(end) };
}

export function addMonths(iso: string, months: number): string {
  const d = parseISO(iso);
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)));
}

/** Weeks (Mon–Sun) covering the month containing `iso`; days outside the month are null. */
export function monthGrid(iso: string): (string | null)[][] {
  const { start, end } = monthBounds(iso);
  const first = parseISO(start);
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days: (string | null)[] = Array(offset).fill(null);
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) days.push(cur);
  while (days.length % 7) days.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

export const isWeekend = (iso: string) => [0, 6].includes(parseISO(iso).getUTCDay());
