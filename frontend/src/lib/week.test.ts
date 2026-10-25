// TZ=America/Toronto (see vite.config.ts).
import { describe, expect, it } from "vitest";

import { addDays, formatDuration, mondayOf, toLocalDateString } from "./week";

describe("mondayOf", () => {
  it.each([
    [new Date(2026, 9, 12, 9), "2026-10-12"], // Monday itself
    [new Date(2026, 9, 14, 23, 59), "2026-10-12"], // Wednesday
    [new Date(2026, 9, 18, 23, 30), "2026-10-12"], // Sunday night still belongs to that week
    [new Date(2026, 10, 1, 12), "2026-10-26"], // across a month boundary (and DST day)
  ])("%s -> %s", (date, monday) => {
    expect(mondayOf(date)).toBe(monday);
  });
});

describe("toLocalDateString", () => {
  it("uses the local date, not the UTC date", () => {
    // 22:00 on Oct 12 in Toronto is already Oct 13 in UTC.
    expect(toLocalDateString(new Date("2026-10-13T02:00:00Z"))).toBe("2026-10-12");
  });
});

describe("addDays", () => {
  it("moves by calendar days across DST", () => {
    expect(addDays("2026-10-26", 7)).toBe("2026-11-02");
    expect(addDays("2026-11-02", -7)).toBe("2026-10-26");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [25 * 60, "25m"],
    [60 * 60, "1h"],
    [90 * 60, "1h 30m"],
    [135 * 60 + 29, "2h 15m"],
  ])("%i s -> %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
