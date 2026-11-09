import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "@/api/app";
import { VERSION } from "@/version";

const installSourceFor = async (source: string | undefined) => {
  const res = await app.request("/api/v1/health", {}, { ...env, EDGEBEAT_INSTALL_SOURCE: source });
  return ((await res.json()) as { installSource: unknown }).installSource;
};

describe("health", () => {
  it("GET /api/v1/health reports version and install source", async () => {
    const res = await SELF.fetch("https://edgebeat.test/api/v1/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string; installSource: unknown };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(VERSION);
    expect(body.installSource).toBe("git");
  });

  it("maps an unknown install source to null", async () => {
    expect(await installSourceFor("weird")).toBeNull();
  });

  it("maps a missing install source to null", async () => {
    expect(await installSourceFor(undefined)).toBeNull();
  });

  it.each(["cli", "cloud", "git"])("passes through %s", async (source) => {
    expect(await installSourceFor(source)).toBe(source);
  });
});
