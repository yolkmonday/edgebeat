import { describe, expect, test } from "bun:test";
import { assetHash } from "./assets";

describe("assetHash", () => {
  test("first 32 hex of sha256(base64(bytes) + extension)", async () => {
    const bytes = new TextEncoder().encode("<h1>hi</h1>");
    const b64 = btoa("<h1>hi</h1>");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${b64}html`));
    const expected = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
    const hash = await assetHash("/index.html", bytes);
    expect(hash).toBe(expected);
    expect(hash).toHaveLength(32);
  });

  test("extension changes the hash; no extension is allowed", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await assetHash("/a.js", bytes)).not.toBe(await assetHash("/a.css", bytes));
    expect(await assetHash("/LICENSE", bytes)).toHaveLength(32);
  });
});
