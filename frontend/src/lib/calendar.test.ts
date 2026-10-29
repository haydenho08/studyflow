// TZ=America/Toronto. The week of Mon 2026-10-26 contains the DST change (clocks fall back Nov 1).
import { describe, expect, it } from "vitest";

import type { Assignment } from "../api/types";
import { groupByLocalDay, isOverdue, openCount, weekDays } from "./calendar";

function assignment(id: number, due_at: string, status: Assignment["status"] = "todo"): Assignment {
  return {
    id,
    course_id: 1,
    title: `A${id}`,
    description: null,
    kind: "assignment",
    due_at,
    priority: "medium",
    status,
    created_at: "2026-10-01T00:00:00Z",
    series_id: null,
    weight: null,
    score: null,
    out_of: null,
    updated_at: "2026-10-01T00:00:00Z",
  };
}

describe("weekDays", () => {
  it("lists 7 local dates across the DST change", () => {
    expect(weekDays("2026-10-26")).toEqual([
      "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01",
    ]);
  });
});

describe("groupByLocalDay", () => {
  it("puts each deadline on its local day, not its UTC day", () => {
    const groups = groupByLocalDay([
      assignment(1, "2026-10-27T03:30:00Z"), // Mon Oct 26, 23:30 EDT
      assignment(2, "2026-11-02T04:59:00Z"), // Sun Nov 1, 23:59 EST (after the clocks change)
      assignment(3, "2026-11-02T05:00:00Z"), // Mon Nov 2, 00:00 EST: next week
    ]);
    expect(groups.get("2026-10-26")?.map((a) => a.id)).toEqual([1]);
    expect(groups.get("2026-10-27")).toBeUndefined();
    expect(groups.get("2026-11-01")?.map((a) => a.id)).toEqual([2]);
    expect(groups.get("2026-11-02")?.map((a) => a.id)).toEqual([3]);
  });

  it("keeps the API's order within a day", () => {
    const groups = groupByLocalDay([
      assignment(5, "2026-10-28T13:00:00Z"),
      assignment(4, "2026-10-28T20:00:00Z"),
    ]);
    expect(groups.get("2026-10-28")?.map((a) => a.id)).toEqual([5, 4]);
  });
});

describe("isOverdue / openCount", () => {
  const now = new Date("2026-10-28T16:00:00Z");

  it("is overdue only if past due and not done", () => {
    expect(isOverdue(assignment(1, "2026-10-28T15:59:00Z"), now)).toBe(true);
    expect(isOverdue(assignment(2, "2026-10-28T15:59:00Z", "done"), now)).toBe(false);
    expect(isOverdue(assignment(3, "2026-10-28T16:01:00Z"), now)).toBe(false);
  });

  it("counts open deadlines", () => {
    expect(openCount([assignment(1, now.toISOString()), assignment(2, now.toISOString(), "done")])).toBe(1);
  });
});
