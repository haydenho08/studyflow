import { describe, expect, it } from "vitest";

import { decimalOrNull, describeTarget, formatPercent } from "./grades";

describe("formatPercent", () => {
  it.each([
    [81, "81%"],
    [66.67, "66.67%"],
    [7.5, "7.5%"],
    [0, "0%"],
  ])("%d -> %s", (value, text) => {
    expect(formatPercent(value)).toBe(text);
  });
});

describe("describeTarget", () => {
  const base = { letter: "A", minimum: 80 } as const;

  it("gives the average needed on the rest", () => {
    expect(describeTarget({ ...base, status: "possible", needed: 79.5 })).toBe("79.5%");
  });

  it.each([
    ["secured", "Secured"],
    ["out_of_reach", "Out of reach"],
  ] as const)("%s", (status, text) => {
    expect(describeTarget({ ...base, status, needed: null })).toBe(text);
  });
});

describe("decimalOrNull", () => {
  it("keeps the typed digits and treats blank as nothing", () => {
    expect(decimalOrNull(" 18.5 ")).toBe("18.5");
    expect(decimalOrNull("")).toBeNull();
    expect(decimalOrNull("   ")).toBeNull();
  });
});
