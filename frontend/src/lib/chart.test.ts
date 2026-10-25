import { describe, expect, it } from "vitest";

import { COURSE_PALETTE_LIGHT, colorDistance, displayColor, nextCourseColor } from "./colors";
import { timeTicks } from "./chart";

describe("timeTicks", () => {
  it.each([
    [0, [0, 10, 20, 30]],
    [25, [0, 10, 20, 30]],
    [75, [0, 30, 60, 90]],
    [200, [0, 60, 120, 180, 240]],
    [600, [0, 180, 360, 540, 720]],
  ])("max %i min -> %j", (max, ticks) => {
    expect(timeTicks(max)).toEqual(ticks);
  });

  it("always reaches the maximum", () => {
    for (const max of [1, 59, 61, 119, 721, 1000]) {
      expect(timeTicks(max).at(-1)!).toBeGreaterThanOrEqual(max);
    }
  });
});

describe("course colours", () => {
  it("assigns palette colours in fixed order, skipping ones in use", () => {
    expect(nextCourseColor([])).toBe(COURSE_PALETTE_LIGHT[0]);
    expect(nextCourseColor(["#2a78d6"])).toBe(COURSE_PALETTE_LIGHT[1]); // case-insensitive
    expect(nextCourseColor(["#EB6834"])).toBe(COURSE_PALETTE_LIGHT[0]);
  });

  it("skips palette colours that merely look like one in use", () => {
    // The old default #3B82F6 isn't in the palette, but it's nearly the palette's blue.
    expect(colorDistance("#3B82F6", "#2A78D6")).toBeLessThan(15);
    expect(nextCourseColor(["#3B82F6"])).toBe(COURSE_PALETTE_LIGHT[1]);
    // A red course rules out the palette's red too.
    expect(nextCourseColor(["#3B82F6", "#E11D48", "#EB6834"])).toBe(COURSE_PALETTE_LIGHT[2]);
  });

  it("still returns a colour when every palette colour is taken", () => {
    expect(COURSE_PALETTE_LIGHT).toContain(nextCourseColor([...COURSE_PALETTE_LIGHT]));
  });

  it("swaps palette colours for their dark step, leaves custom colours alone", () => {
    expect(displayColor("#2A78D6", true)).toBe("#3987E5");
    expect(displayColor("#2A78D6", false)).toBe("#2A78D6");
    expect(displayColor("#123456", true)).toBe("#123456");
  });
});
