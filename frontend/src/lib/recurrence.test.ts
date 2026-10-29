// TZ=America/Toronto (see vite.config.ts).
import { describe, expect, it } from "vitest";

import { NO_REPEAT, describeRepeat, repeatDays, toRepeatRule, weekdayOf } from "./recurrence";

describe("weekdayOf", () => {
  it.each([
    ["2026-10-26T09:00", 0], // Monday
    ["2026-10-23T23:59", 4], // Friday, late: still Friday locally (Saturday in UTC)
    ["2026-11-01T12:00", 6], // Sunday, the day the clocks change
  ])("%s -> %i", (input, day) => {
    expect(weekdayOf(input)).toBe(day);
  });
});

describe("repeatDays", () => {
  it("always includes the first due date's day, sorted", () => {
    const values = { ...NO_REPEAT, enabled: true, weekdays: [3, 1] };
    expect(repeatDays(values, "2026-10-23T23:59")).toEqual([1, 3, 4]);
  });

  it("doesn't repeat a day that was already chosen", () => {
    const values = { ...NO_REPEAT, enabled: true, weekdays: [4] };
    expect(repeatDays(values, "2026-10-23T23:59")).toEqual([4]);
  });
});

describe("toRepeatRule", () => {
  const due = "2026-10-23T23:59";

  it("sends count or until, never both", () => {
    const base = { ...NO_REPEAT, enabled: true, count: "8", until: "2026-12-04" };
    expect(toRepeatRule({ ...base, end: "count" }, due, "America/Toronto")).toEqual({
      weekdays: [4],
      every_weeks: 1,
      count: 8,
      until: null,
      time_zone: "America/Toronto",
    });
    expect(toRepeatRule({ ...base, end: "until" }, due, "America/Toronto")).toMatchObject({
      count: null,
      until: "2026-12-04",
    });
  });
});

describe("describeRepeat", () => {
  const friday = "2026-10-23T23:59";
  const on = { ...NO_REPEAT, enabled: true };

  it("weekly, a number of times", () => {
    expect(describeRepeat(on, friday)).toBe("Every week on Fri, 10 times");
  });

  it("several days every other week, until a date", () => {
    const values = { ...on, weekdays: [1, 3], everyWeeks: 2, end: "until" as const, until: "2026-12-04" };
    expect(describeRepeat(values, friday)).toBe("Every 2 weeks on Tue, Thu and Fri, until Fri, Dec 4");
  });

  it("before an end date is picked", () => {
    expect(describeRepeat({ ...on, end: "until" }, friday)).toBe("Every week on Fri, until…");
  });
});
