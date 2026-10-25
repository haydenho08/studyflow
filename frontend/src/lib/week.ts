// Week arithmetic in the user's local calendar. Weeks start on Monday (ISO 8601).

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar date of `d` as "YYYY-MM-DD" (not toISOString, which would give the UTC date). */
export function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD" -> a Date at local midnight that day. */
export function parseLocalDate(date: string): Date {
  return new Date(`${date}T00:00`);
}

/** The Monday on or before `d`. */
export function mondayOf(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysSinceMonday = (copy.getDay() + 6) % 7; // getDay(): Sunday = 0
  copy.setDate(copy.getDate() - daysSinceMonday);
  return toLocalDateString(copy);
}

export function addDays(date: string, days: number): string {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}

/** The browser's IANA time zone, e.g. "America/Toronto". Sent to the stats API. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 5400 -> "1h 30m", 300 -> "5m", 0 -> "0m". */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

const rangeFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** "Oct 12 – Oct 18" for the week starting `start`. */
export function formatWeekRange(start: string): string {
  return rangeFormat.formatRange(parseLocalDate(start), parseLocalDate(addDays(start, 6)));
}
