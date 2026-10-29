// The "Repeats weekly" part of the new-assignment form. The API does the real expansion into due
// dates (app/recurrence.py); this only turns the form's choices into its RepeatRule and words.
import type { RepeatRule } from "../api/types";

/** Monday first, as the API counts them (Monday = 0 … Sunday = 6). */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface RepeatValues {
  enabled: boolean;
  weekdays: number[];
  everyWeeks: number;
  end: "count" | "until";
  count: string; // <input type="number">
  until: string; // <input type="date">, YYYY-MM-DD
}

export const NO_REPEAT: RepeatValues = {
  enabled: false,
  weekdays: [],
  everyWeeks: 1,
  end: "count",
  count: "10",
  until: "",
};

/** The API's weekday number of a datetime-local value ("2026-10-23T23:59" -> 4, a Friday). */
export function weekdayOf(dateTimeInput: string): number {
  const day = new Date(dateTimeInput).getDay(); // JS counts from Sunday = 0
  return (day + 6) % 7;
}

/** The repeat days, always including the first due date's own day (the API requires it). */
export function repeatDays(values: RepeatValues, due: string): number[] {
  return [...new Set([...values.weekdays, weekdayOf(due)])].sort((a, b) => a - b);
}

export function toRepeatRule(values: RepeatValues, due: string, timeZone: string): RepeatRule {
  return {
    weekdays: repeatDays(values, due),
    every_weeks: values.everyWeeks,
    count: values.end === "count" ? Number(values.count) : null,
    until: values.end === "until" ? values.until : null,
    time_zone: timeZone,
  };
}

function joinDays(days: number[]): string {
  const names = days.map((d) => WEEKDAYS[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
}

const untilFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

/** "Every week on Fri, 10 times" / "Every 2 weeks on Tue and Thu, until Fri, Dec 4". */
export function describeRepeat(values: RepeatValues, due: string): string {
  const every = values.everyWeeks === 1 ? "Every week" : `Every ${values.everyWeeks} weeks`;
  const end =
    values.end === "count"
      ? `${values.count} times`
      : values.until
        ? `until ${untilFormat.format(new Date(`${values.until}T00:00`))}`
        : "until…";
  return `${every} on ${joinDays(repeatDays(values, due))}, ${end}`;
}
