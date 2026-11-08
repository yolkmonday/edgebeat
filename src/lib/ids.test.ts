import { describe, expect, it } from "bun:test";
import { newId, newToken } from "@/lib/ids";

describe("newId", () => {
  it("is 26 chars of Crockford base32", () => {
    const id = newId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
  it("sorts lexicographically across milliseconds", async () => {
    const a = newId();
    await new Promise((r) => setTimeout(r, 3));
    const b = newId();
    expect(a < b).toBe(true);
  });
  it("is unique", () => {
    const set = new Set(Array.from({ length: 5000 }, () => newId()));
    expect(set.size).toBe(5000);
  });
});

describe("newToken", () => {
  it("is 22 chars base64url without padding", () => {
    const t = newToken();
    expect(t).toHaveLength(22);
    expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
  it("is unique", () => {
    const set = new Set(Array.from({ length: 5000 }, () => newToken()));
    expect(set.size).toBe(5000);
  });
});
