import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRESETS,
  elapsedMs,
  formatClock,
  isFinished,
  remainingMs,
  sessionFor,
  startBreak,
  startFocus,
  IDLE,
  loadTimer,
  saveTimer,
} from "./pomodoro";

const classic = PRESETS[0]!;
const T0 = Date.UTC(2026, 9, 12, 14, 0, 0); // 2026-10-12T14:00:00Z
const MIN = 60_000;

describe("focus timer", () => {
  const focus = startFocus(1, 7, classic, T0);

  it("counts down from the preset length", () => {
    expect(remainingMs(focus, T0)).toBe(25 * MIN);
    expect(remainingMs(focus, T0 + 10 * MIN)).toBe(15 * MIN);
    expect(isFinished(focus, T0 + 25 * MIN - 1)).toBe(false);
    expect(isFinished(focus, T0 + 25 * MIN)).toBe(true);
  });

  it("is computed from timestamps, so a long gap (sleep, background tab) can't make it drift", () => {
    expect(remainingMs(focus, T0 + 3 * 60 * MIN)).toBe(0);
    expect(elapsedMs(focus, T0 + 3 * 60 * MIN)).toBe(25 * MIN); // capped at the block length
  });

  it("logs exactly the planned block, even if we notice it finished late", () => {
    expect(sessionFor(focus, focus.startedAt + focus.durationMs)).toEqual({
      course_id: 7,
      started_at: "2026-10-12T14:00:00.000Z",
      ended_at: "2026-10-12T14:25:00.000Z",
    });
  });
});

describe("break", () => {
  it("starts when the focus block was due to end, not when it was noticed", () => {
    const brk = startBreak(startFocus(1, 7, classic, T0));
    expect(brk.phase).toBe("break");
    expect(brk.startedAt).toBe(T0 + 25 * MIN);
    expect(brk.durationMs).toBe(5 * MIN);
    expect(brk.courseId).toBe(7);
  });

  it("uses the preset's break length", () => {
    const brk = startBreak(startFocus(1, 7, PRESETS[1]!, T0));
    expect(brk.durationMs).toBe(10 * MIN);
  });
});

describe("loadTimer", () => {
  const stored = startFocus(1, 7, classic, T0);

  // Tests run in Node: give them an in-memory localStorage instead of a browser one.
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the stored timer only to the user who started it", () => {
    localStorage.setItem("studyflow.timer", JSON.stringify(stored));
    expect(loadTimer(1)).toEqual(stored);
    expect(loadTimer(2)).toEqual(IDLE); // someone else on this computer
    expect(loadTimer(undefined)).toEqual(IDLE);
  });

  it("ignores malformed or old-format data", () => {
    localStorage.setItem("studyflow.timer", "{not json");
    expect(loadTimer(1)).toEqual(IDLE);
    // Saved before timers had owners:
    localStorage.setItem("studyflow.timer", JSON.stringify({ ...stored, userId: undefined }));
    expect(loadTimer(1)).toEqual(IDLE);
  });

  it("saveTimer(IDLE) clears it", () => {
    saveTimer(stored);
    saveTimer(IDLE);
    expect(localStorage.getItem("studyflow.timer")).toBeNull();
  });
});

describe("formatClock", () => {
  it.each([
    [25 * MIN, "25:00"],
    [25 * MIN - 1, "25:00"], // rounds up: never shows 24:59 at the very start
    [61_000, "01:01"],
    [999, "00:01"], // never 00:00 while time remains
    [0, "00:00"],
  ])("%i ms -> %s", (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });
});
