import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import worker from "@/index";
import type { PublicStatus } from "@/core/public-status";

const db = getDb(env);
const KEY = "https://edgebeat.test/api/v1/status";
// run through the worker with an execution context so the cache.put in waitUntil has settled on return
const get = async (query = "") => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${KEY}${query}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
};

const addMonitor = (id: string, extra: Partial<typeof t.monitors.$inferInsert> = {}) =>
  db.insert(t.monitors).values({
    id,
    slug: id,
    name: id,
    type: "http",
    url: "https://example.com",
    intervalMin: 5,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  });

beforeEach(async () => {
  await caches.default.delete(new Request(KEY));
  await db.batch([
    db.delete(t.snapshot),
    db.delete(t.settings),
    db.delete(t.monitors),
    db.delete(t.groups),
  ]);
});

describe("GET /api/v1/status", () => {
  it("serves seeded status with cache headers", async () => {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    await db.insert(t.groups).values({ id: "g1", slug: "core", name: "Core", sort: 0 });
    await db.insert(t.settings).values({ key: "siteName", value: JSON.stringify("Acme") });
    await addMonitor("web", { groupId: "g1" });
    await addMonitor("secret", { isPublic: 0 });
    await addMonitor("old", { paused: 1 });
    await db.insert(t.snapshot).values({
      id: 1,
      lastTickAt: now - 5_000,
      current: JSON.stringify({
        web: { state: "up", lastCheckedAt: now - 1_000, latencyMs: 40 },
        secret: { state: "up", lastCheckedAt: now - 1_000, latencyMs: 40 },
      }),
      bars: JSON.stringify({ web: [{ day: today, uptime: 0.99, downtimeS: 60, observedS: 6000 }] }),
    });

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=15, s-maxage=30");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as PublicStatus;
    expect(body.siteName).toBe("Acme");
    expect(body.stale).toBe(false);
    expect(body.overall).toBe("operational");
    expect(body.groups.map((g) => g.slug)).toEqual(["core", "other"]);
    const web = body.groups[0]!.monitors[0]!;
    expect(web).toMatchObject({ slug: "web", state: "up", uptime90: 0.99 });
    expect(web.bars).toHaveLength(90);
    expect(body.groups[1]!.monitors).toEqual([expect.objectContaining({ slug: "old", state: "paused" })]);
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("missing snapshot row: 200, stale, unknown (never a 500, never green)", async () => {
    await addMonitor("web");
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as PublicStatus;
    expect(body.siteName).toBe("Status");
    expect(body.stale).toBe(true);
    expect(body.lastTickAt).toBeNull();
    expect(body.overall).toBe("unknown");
    expect(body.groups[0]!.monitors[0]!.state).toBe("unknown");
  });

  it("stale snapshot with up state reads unknown", async () => {
    await addMonitor("web");
    const now = Date.now();
    await db.insert(t.snapshot).values({
      id: 1,
      lastTickAt: now - 600_000,
      current: JSON.stringify({ web: { state: "up", lastCheckedAt: now - 600_000, latencyMs: 1 } }),
      bars: "{}",
    });
    const body = (await (await get()).json()) as PublicStatus;
    expect(body.stale).toBe(true);
    expect(body.overall).toBe("unknown");
  });

  it("second request is served from cache", async () => {
    await addMonitor("web");
    const first = (await (await get()).json()) as PublicStatus;
    const second = (await (await get()).json()) as PublicStatus;
    expect(second.generatedAt).toBe(first.generatedAt);
  });

  it("different query strings share one cache entry", async () => {
    await addMonitor("web");
    const first = (await (await get("?a=1")).json()) as PublicStatus;
    expect(first.groups[0]!.monitors).toHaveLength(1);
    await addMonitor("web2");
    const second = (await (await get("?a=2")).json()) as PublicStatus;
    expect(second.groups[0]!.monitors).toHaveLength(1);
    expect(second.generatedAt).toBe(first.generatedAt);
  });
});
