// Calendar week logic: which local day each deadline lands on. Pure functions, unit-tested.
import type { Assignment } from "../api/types";
import { addDays, toLocalDateString } from "./week";

/** The 7 "YYYY-MM-DD" local dates of the week starting `monday`. */
export function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * Group deadlines by the *local* calendar day they fall on. "Due 23:59 Nov 2" is stored as
 * 04:59 UTC on Nov 3; grouping by the UTC date would put it on the wrong day.
 * Input order is kept within each day (the API already sorts by due time).
 */
export function groupByLocalDay(assignments: readonly Assignment[]): Map<string, Assignment[]> {
  const byDay = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const day = toLocalDateString(new Date(a.due_at));
    const list = byDay.get(day);
    if (list) list.push(a);
    else byDay.set(day, [a]);
  }
  return byDay;
}

export function isOverdue(assignment: Assignment, now: Date): boolean {
  return assignment.status !== "done" && new Date(assignment.due_at) < now;
}

/** Workload hint for a day: how many deadlines are still open. */
export function openCount(assignments: readonly Assignment[]): number {
  return assignments.filter((a) => a.status !== "done").length;
}
