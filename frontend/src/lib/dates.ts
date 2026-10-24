// The API speaks UTC instants ("2026-11-03T04:59:00Z"); people think in local wall-clock time.
// Every conversion between the two lives in this file.

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC instant -> "YYYY-MM-DDTHH:mm" in local time, the format <input type="datetime-local"> uses. */
export function toDateTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (local time, no offset) -> UTC instant for the API. */
export function fromDateTimeInput(value: string): string {
  // A date-time string without an offset is parsed as *local* time by the JS spec.
  return new Date(value).toISOString();
}

/**
 * UTC instant of local midnight at the start of `date` ("YYYY-MM-DD"), shifted by `addDays`.
 * Uses calendar arithmetic (setDate), not "+ 24 hours", so DST changes don't shift the result.
 */
export function localDayStart(date: string, addDays = 0): string {
  const d = new Date(`${date}T00:00`);
  d.setDate(d.getDate() + addDays);
  return d.toISOString();
}

/** Default due date for a new assignment: tomorrow at 23:59 local time. */
export function defaultDueInput(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(23, 59, 0, 0);
  return toDateTimeInput(d.toISOString());
}

const dueFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDue(iso: string): string {
  return dueFormat.format(new Date(iso));
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "in 3 days", "tomorrow", "2 hours ago". */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (Math.abs(minutes) < 60) return relativeFormat.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeFormat.format(hours, "hour");
  return relativeFormat.format(Math.round(hours / 24), "day");
}
