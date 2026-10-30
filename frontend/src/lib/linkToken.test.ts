import { describe, expect, it } from "vitest";

import { readLinkToken } from "./linkToken";

describe("readLinkToken", () => {
  it("reads the token from the hash", () => {
    expect(readLinkToken("#token=AbC-_123")).toBe("AbC-_123");
  });

  it.each(["", "#", "#token=", "#other=1", "#token=has spaces", "#token=<script>"])("%j -> null", (hash) => {
    expect(readLinkToken(hash)).toBeNull();
  });
});
