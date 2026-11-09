import { describe, expect, test } from "bun:test";
import { hashToken, looksLikeToken, newApiToken, tokenPrefix } from "@/lib/api-tokens";

describe("api tokens", () => {
  test("format: eb_ + 43 base64url chars, 46 total", () => {
    const t = newApiToken();
    expect(t).toHaveLength(46);
    expect(looksLikeToken(t)).toBe(true);
    expect(tokenPrefix(t)).toBe(t.slice(0, 10));
  });

  test("two tokens differ", () => {
    expect(newApiToken()).not.toBe(newApiToken());
  });

  test("hash is 64 hex chars and stable", async () => {
    const t = newApiToken();
    const h = await hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(t)).toBe(h);
    expect(await hashToken(newApiToken())).not.toBe(h);
  });

  test("looksLikeToken rejects malformed input", () => {
    for (const bad of ["", "eb_", "eb_short", `xx_${"a".repeat(43)}`, `eb_${"a".repeat(44)}`, `eb_${"!".repeat(43)}`]) {
      expect(looksLikeToken(bad)).toBe(false);
    }
  });
});
