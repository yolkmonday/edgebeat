import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("health", () => {
  it("GET /api/v1/health returns ok", async () => {
    const res = await SELF.fetch("https://edgebeat.test/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
