import { beforeEach, describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import type { EventsPage, Overview, Session } from "@/shared/admin-api";
import { call, db, getCookie, monitorRow, resetAdminDb, rowCounts, seedSnapshot } from "./admin-test-utils";

let cookie = "";

beforeEach(async () => {
  await resetAdminDb();
  cookie = await getCookie();
});

const DAY_MS = 86_400_000;
const get = async <T>(path: string): Promise<T> => {
  const res = await call(cookie, "GET", path);
  expect(res.status).toBe(200);
  return (await res.json()) as T;
};

describe("overview", () => {
  it("overview reports stale tick and unknown states", async () => {
    const now = Date.now();
    await db.insert(t.monitors).values([monitorRow("a"), monitorRow("b"), monitorRow("off", { paused: 1 })]);
    const old = now - 10 * 60_000;
    await seedSnapshot(old, { a: { state: "up", lastCheckedAt: old, latencyMs: 20 }, b: { state: "down", lastCheckedAt: old, latencyMs: 20 } });
    const o = await get<Overview>("/overview");
    expect(o.tick).toEqual({ lastTickAt: old, stale: true });
    expect(o.counts).toMatchObject({ unknown: 2, paused: 1, up: 0, down: 0 });
  });

  it("treats a never-ticked install as stale with a null lastTickAt", async () => {
    await db.insert(t.monitors).values(monitorRow("a"));
    await seedSnapshot(0);
    const o = await get<Overview>("/overview");
    expect(o.tick).toEqual({ lastTickAt: null, stale: true });
    expect(o.counts.unknown).toBe(1);
  });

  it("counts states, totals and usage on a fresh tick", async () => {
    const now = Date.now();
    await db.insert(t.monitors).values([
      monitorRow("a"),
      monitorRow("b", { isPublic: 0 }),
      monitorRow("c", { intervalMin: 5 }),
      monitorRow("hb", { type: "heartbeat", url: null, heartbeatPeriodS: 60 }),
    ]);
    const entry = (state: string) => ({ state, lastCheckedAt: now - 1000, latencyMs: 10 });
    await seedSnapshot(now - 1000, { a: entry("up"), b: entry("down"), c: entry("degraded"), hb: entry("up") });

    const o = await get<Overview>("/overview");
    expect(o.tick.stale).toBe(false);
    expect(o.counts).toMatchObject({ up: 2, down: 1, degraded: 1 });
    expect(o.totals).toEqual({ all: 4, checks: 3, heartbeats: 1 });
    expect(o.usage.checksPerMinute.plan).toBe("free");
    expect(o.usage.checksPerMinute.budget).toBe(40);
    expect(o.usage.checksPerMinute.used).toBeGreaterThanOrEqual(2);
    expect(o.usage.d1WritesToday).toMatchObject({ source: "estimate", limit: 100_000 });
    expect(o.usage.requestsToday).toBeNull();
  });

  it("estimates ticks from the first tick of today, not from midnight", async () => {
    const now = Date.now();
    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    const minute = Math.floor(now / 60_000);
    await seedSnapshot(minute * 60_000);
    await db.insert(t.ticks).values([
      { minute: minute - 1, at: (minute - 1) * 60_000, results: "[]" },
      { minute, at: minute * 60_000, results: "[]" },
    ]);
    const o = await get<Overview>("/overview");
    // 2 ticks * 3 writes + hourly housekeeping rows; a midnight-based estimate would count every minute since 00:00
    const hourly = Math.floor((now - dayStart) / 3_600_000) * 60;
    expect(o.usage.d1WritesToday.value).toBe(6 + hourly);
    expect(o.usage.d1WritesToday.source).toBe("estimate");
  });

  it("has no limit on the paid plan", async () => {
    await db.insert(t.settings).values({ key: "plan", value: JSON.stringify("paid") });
    const o = await get<Overview>("/overview");
    expect(o.usage.d1WritesToday.limit).toBeNull();
  });

  it("lists recent events newest first, max 5, last 7 days only", async () => {
    const now = Date.now();
    await db.insert(t.monitors).values(monitorRow("a"));
    await db.insert(t.events).values([
      { monitorId: "a", fromState: "up", toState: "down", at: now - 10 * DAY_MS, reason: "timeout" },
      ...Array.from({ length: 6 }, (_, i) => ({
        monitorId: "a",
        fromState: i % 2 ? ("down" as const) : ("up" as const),
        toState: i % 2 ? ("up" as const) : ("down" as const),
        at: now - (6 - i) * 3_600_000,
        reason: "ok",
      })),
    ]);
    const o = await get<Overview>("/overview");
    expect(o.recentEvents).toHaveLength(5);
    expect(o.recentEvents.map((e) => e.at)).toEqual([...o.recentEvents.map((e) => e.at)].sort((a, b) => b - a));
    expect(o.recentEvents.every((e) => e.at > now - 7 * DAY_MS)).toBe(true);
    expect(o.recentEvents[0]).toMatchObject({ monitorName: "a", monitorType: "http" });
  });
});

describe("session", () => {
  it("returns version, counts and analytics flag", async () => {
    await db.insert(t.groups).values({ id: "g", slug: "g", name: "G", sort: 0 });
    await db.insert(t.monitors).values([
      monitorRow("a"),
      monitorRow("b", { type: "tcp", url: null, host: "example.com", port: 443 }),
      monitorRow("hb", { type: "heartbeat", url: null, heartbeatPeriodS: 60 }),
    ]);
    await db.insert(t.settings).values({ key: "siteName", value: JSON.stringify("Acme") });
    const s = await get<Session>("/session");
    expect(s).toMatchObject({
      version: "0.1.0",
      siteName: "Acme",
      plan: "free",
      auth: "cookie",
      scope: "admin",
      analytics: false,
      counts: { monitors: 2, heartbeats: 1, groups: 1 },
    });
  });

  it("is 401 without a session", async () => {
    expect((await call("", "GET", "/session")).status).toBe(401);
    expect((await call("", "GET", "/overview")).status).toBe(401);
    expect((await call("", "GET", "/events")).status).toBe(401);
  });
});

describe("events", () => {
  const seedEvents = async (n: number) => {
    const now = Date.now();
    await db.insert(t.monitors).values([monitorRow("a"), monitorRow("b")]);
    await db.insert(t.events).values(
      Array.from({ length: n }, (_, i) => ({
        monitorId: i % 2 ? "b" : "a",
        fromState: "up" as const,
        toState: "down" as const,
        at: now - (n - i) * 60_000,
        reason: "timeout",
      })),
    );
  };

  it("paginates with disjoint pages and a null cursor at the end", async () => {
    await seedEvents(5);
    const first = await get<EventsPage>("/events?limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.nextBefore).toBe(first.items[1]!.id);
    const second = await get<EventsPage>(`/events?limit=2&before=${first.nextBefore}`);
    const third = await get<EventsPage>(`/events?limit=2&before=${second.nextBefore}`);
    expect(third.items).toHaveLength(1);
    expect(third.nextBefore).toBeNull();
    const ids = [...first.items, ...second.items, ...third.items].map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it("filters by monitor and rejects a bad limit", async () => {
    await seedEvents(4);
    const page = await get<EventsPage>("/events?monitorId=b");
    expect(page.items).toHaveLength(2);
    expect(page.items.every((e) => e.monitorId === "b")).toBe(true);
    expect((await call(cookie, "GET", "/events?limit=500")).status).toBe(400);
  });

  it("returns an empty page", async () => {
    expect(await get<EventsPage>("/events")).toEqual({ items: [], nextBefore: null });
  });
});

describe("admin reads do not write", () => {
  it("leaves every table untouched", async () => {
    const now = Date.now();
    await db.insert(t.groups).values({ id: "g", slug: "g", name: "G", sort: 0 });
    await db.insert(t.monitors).values([monitorRow("a", { groupId: "g" }), monitorRow("hb", { type: "heartbeat", url: null, heartbeatPeriodS: 60 })]);
    await db.insert(t.heartbeats).values({ monitorId: "hb", lastBeatAt: now });
    await db.insert(t.events).values({ monitorId: "a", fromState: "up", toState: "down", at: now, reason: "timeout" });
    await seedSnapshot(now, { a: { state: "up", lastCheckedAt: now, latencyMs: 5 } });

    const before = await rowCounts();
    for (const path of ["/overview", "/monitors", "/monitors/a", "/monitors/hb", "/events", "/session", "/settings", "/groups"]) {
      expect((await call(cookie, "GET", path)).status).toBe(200);
    }
    expect(await rowCounts()).toEqual(before);
  });
});
