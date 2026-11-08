import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("static assets", () => {
  // SELF.fetch in the test pool calls the worker directly (no asset layer in front), so the
  // built assets are checked through the ASSETS binding, which serves the same directory.
  it("serves the built status page shell at /", async () => {
    const res = await env.ASSETS.fetch("https://edgebeat.test/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain('<div id="app">');
  });

  it("still routes /api/* to the worker", async () => {
    const res = await SELF.fetch("https://edgebeat.test/api/v1/status");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
