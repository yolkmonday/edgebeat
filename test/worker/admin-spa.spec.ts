import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const BASE = "https://upflare.test";

describe("admin spa fallback", () => {
  it("serves the SPA shell with security headers at /admin and on deep links", async () => {
    for (const path of ["/admin", "/admin/", "/admin/monitors/abc", "/admin/login"]) {
      const res = await SELF.fetch(`${BASE}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain('<div id="root">');
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("form-action 'self'");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("same-origin");
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("allows no inline or remote script in the CSP", async () => {
    const csp = (await SELF.fetch(`${BASE}/admin`)).headers.get("content-security-policy") ?? "";
    const script = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(script.trim()).toBe("script-src 'self'");
  });

  it("never answers a missing file with HTML", async () => {
    const res = await SELF.fetch(`${BASE}/admin/assets/missing.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
    expect((await SELF.fetch(`${BASE}/admin/nope.css`)).status).toBe(404);
  });

  it("serves built files as themselves", async () => {
    const icon = await SELF.fetch(`${BASE}/admin/favicon.svg`);
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toContain("image/svg+xml");
    expect(icon.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("caches hashed assets as immutable", async () => {
    const html = await (await SELF.fetch(`${BASE}/admin`)).text();
    const src = /src="(\/admin\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    expect(src, "built entry script in the shell").toBeTruthy();
    const res = await SELF.fetch(`${BASE}${src}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("does not touch the status page or the api", async () => {
    expect((await SELF.fetch(`${BASE}/api/v1/health`)).status).toBe(200);
    const status = await SELF.fetch(`${BASE}/api/v1/status`);
    expect(status.headers.get("content-security-policy")).toBeNull();
  });
});
