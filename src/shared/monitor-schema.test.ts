import { describe, expect, test } from "bun:test";
import { monitorInput, slugify } from "./monitor-schema";

const http = { name: "Site", slug: "site", type: "http" as const, url: "https://example.com" };

describe("monitorInput", () => {
  test("accepts a minimal http monitor", () => {
    expect(monitorInput.safeParse(http).success).toBe(true);
  });
  test("rejects interval 4", () => {
    expect(monitorInput.safeParse({ ...http, intervalMin: 4 }).success).toBe(false);
  });
  test("rejects tcp port 25", () => {
    expect(monitorInput.safeParse({ name: "m", slug: "m", type: "tcp", host: "example.com", port: 25 }).success).toBe(false);
  });
  test("rejects GET with body", () => {
    expect(monitorInput.safeParse({ ...http, method: "GET", body: "x" }).success).toBe(false);
  });
  test("rejects HEAD with keyword", () => {
    expect(monitorInput.safeParse({ ...http, method: "HEAD", keyword: "ok" }).success).toBe(false);
  });
  test("heartbeat needs period and grace", () => {
    expect(monitorInput.safeParse({ name: "j", slug: "j", type: "heartbeat" }).success).toBe(false);
    expect(monitorInput.safeParse({ name: "j", slug: "j", type: "heartbeat", heartbeatPeriodS: 300, heartbeatGraceS: 60 }).success).toBe(true);
  });
});

describe("slugify", () => {
  test("basic", () => expect(slugify("Acme API!")).toBe("acme-api"));
  test("empty fallback", () => expect(slugify("!!!")).toBe("monitor"));
  test("max 64 chars", () => expect(slugify("a".repeat(100)).length).toBe(64));
});
