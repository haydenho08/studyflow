// vite.config.ts pins TZ=America/Toronto (UTC-4 in summer, UTC-5 in winter; DST ends 2026-11-01).
import { describe, expect, it } from "vitest";

import { defaultDueInput, formatRelative, fromDateTimeInput, localDayStart, toDateTimeInput } from "./dates";

describe("datetime-local conversions", () => {
  it("treats the input as local time and sends UTC", () => {
    expect(fromDateTimeInput("2026-11-02T23:59")).toBe("2026-11-03T04:59:00.000Z"); // EST, UTC-5
    expect(fromDateTimeInput("2026-10-20T23:59")).toBe("2026-10-21T03:59:00.000Z"); // EDT, UTC-4
  });

  it("shows a UTC instant in local time", () => {
    expect(toDateTimeInput("2026-11-03T04:59:00Z")).toBe("2026-11-02T23:59");
  });

  it("round-trips", () => {
    expect(toDateTimeInput(fromDateTimeInput("2026-03-08T09:30"))).toBe("2026-03-08T09:30");
  });
});

describe("localDayStart", () => {
  it("is local midnight as a UTC instant", () => {
    expect(localDayStart("2026-11-02")).toBe("2026-11-02T05:00:00.000Z");
  });

  it("adds calendar days, not 24-hour blocks, across a DST change", () => {
    // Clocks fall back at 2am on Nov 1: midnight Nov 1 is still EDT (UTC-4), midnight Nov 2 is
    // EST (UTC-5). So "the next day" starts 25 hours later, not 24.
    expect(localDayStart("2026-11-01")).toBe("2026-11-01T04:00:00.000Z");
    expect(localDayStart("2026-11-01", 1)).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("defaultDueInput", () => {
  it("is tomorrow at 23:59", () => {
    expect(defaultDueInput(new Date(2026, 9, 24, 15, 0))).toBe("2026-10-25T23:59");
  });

  it("rolls over the month", () => {
    expect(defaultDueInput(new Date(2026, 9, 31, 8, 0))).toBe("2026-11-01T23:59");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-10-24T12:00:00Z");

  it("uses the largest sensible unit", () => {
    expect(formatRelative("2026-10-24T12:30:00Z", now)).toBe("in 30 minutes");
    expect(formatRelative("2026-10-24T17:00:00Z", now)).toBe("in 5 hours");
    expect(formatRelative("2026-10-27T12:00:00Z", now)).toBe("in 3 days");
    expect(formatRelative("2026-10-22T12:00:00Z", now)).toBe("2 days ago");
  });
});
