import { describe, expect, it } from "vitest";

import { googleCalendarUrl, webcalUrl } from "./calendarFeed";

const FEED = "https://studyflow.example/api/calendar/abc_DEF-123.ics";

describe("webcalUrl", () => {
  it("swaps the scheme and keeps the rest", () => {
    expect(webcalUrl(FEED)).toBe("webcal://studyflow.example/api/calendar/abc_DEF-123.ics");
  });

  it("handles plain http (local development)", () => {
    expect(webcalUrl("http://localhost:5173/api/calendar/x.ics")).toBe("webcal://localhost:5173/api/calendar/x.ics");
  });
});

describe("googleCalendarUrl", () => {
  it("passes the whole feed URL as one encoded parameter", () => {
    const url = new URL(googleCalendarUrl(FEED));
    expect(url.origin).toBe("https://calendar.google.com");
    expect(url.searchParams.get("cid")).toBe(webcalUrl(FEED));
  });
});
