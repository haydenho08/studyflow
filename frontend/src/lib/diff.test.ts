import { describe, expect, it } from "vitest";

import { changedFields, isEmpty } from "./diff";

describe("changedFields", () => {
  const original = { title: "Lab 1", priority: "medium", description: "Read ch. 3" as string | null };

  it("returns only the fields that changed", () => {
    expect(changedFields(original, { ...original, priority: "high" })).toEqual({ priority: "high" });
  });

  it("includes a field cleared to null", () => {
    expect(changedFields(original, { ...original, description: null })).toEqual({ description: null });
  });

  it("is empty when nothing changed", () => {
    expect(isEmpty(changedFields(original, { ...original }))).toBe(true);
  });
});
