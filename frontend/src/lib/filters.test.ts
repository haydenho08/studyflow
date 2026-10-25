import { describe, expect, it } from "vitest";

import { readFilterParams, toApiFilters } from "./filters";

describe("readFilterParams", () => {
  it("keeps valid values", () => {
    const params = new URLSearchParams("course=3&status=in_progress&priority=high&from=2026-11-01");
    expect(readFilterParams(params)).toEqual({
      course: 3,
      status: "in_progress",
      priority: "high",
      kind: undefined,
      from: "2026-11-01",
      to: undefined,
    });
  });

  it.each([
    ["course=abc", "course"],
    ["course=-2", "course"],
    ["course=1.5", "course"],
    ["status=finished", "status"],
    ["status=toString", "status"], // inherited object property, not a real status
    ["priority=urgent", "priority"],
    ["from=next-week", "from"],
  ])("ignores junk: %s", (query, key) => {
    expect(readFilterParams(new URLSearchParams(query))[key as "course"]).toBeUndefined();
  });
});

describe("toApiFilters", () => {
  it("turns an inclusive day range into a half-open instant range", () => {
    // TZ=America/Toronto: Nov 1 to Nov 7 means [Nov 1 00:00 local, Nov 8 00:00 local).
    const filters = toApiFilters({ from: "2026-11-01", to: "2026-11-07" });
    expect(filters.due_from).toBe("2026-11-01T04:00:00.000Z"); // still EDT at midnight Nov 1
    expect(filters.due_to).toBe("2026-11-08T05:00:00.000Z");
  });

  it("maps names and leaves unset filters out", () => {
    expect(toApiFilters({ course: 3, status: "todo" })).toEqual({
      course_id: 3,
      status: ["todo"],
      priority: undefined,
      kind: undefined,
      due_from: undefined,
      due_to: undefined,
    });
  });
});
