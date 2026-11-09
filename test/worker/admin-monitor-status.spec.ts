import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as t from "@/db/schema";
import { utcDay } from "@/core/stats";
import type { Group, Monitor, MonitorDetail, Settings, TestCheckResult } from "@/shared/admin-api";
import { call, db, getCookie, monitorRow, resetAdminDb, rowCounts, seedSnapshot } from "./admin-test-utils";

let cookie = "";

beforeEach(async () => {
  await resetAdminDb();
  cookie = await getCookie();
});

afterEach(() => vi.restoreAllMocks());

const DAY_MS = 86_400_000;

describe("monitor status", () => {
  it("adds status to every monitor, private ones included", async () => {
    const now = Date.now();
    const today = utcDay(now);
    await db.insert(t.monitors).values([
      monitorRow("a"),
      monitorRow("secret", { isPublic: 0 }),
      monitorRow("off", { paused: 1 }),
    ]);
    await seedSnapshot(
      now - 5_000,
      {
        a: { state: "down", lastCheckedAt: now - 5_000, latencyMs: 80, code: 503, error: "status" },
        secret: { state: "up", lastCheckedAt: now - 5_000, latencyMs: 40 }, // old snapshot shape: no code/error
      },
      { a: [{ day: today, uptime: 0.9, downtimeS: 100, observedS: 1000 }] },
    );

    const res = await call(cookie, "GET", "/monitors");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Monitor[];
    const byId = Object.fromEntries(list.map((m) => [m.id, m]));
    expect(byId.a!.status).toMatchObject({ state: "down", latencyMs: 80, code: 503, error: "status", uptime30: 0.9 });
    expect(byId.secret!.status).toMatchObject({ state: "up", code: null, error: null, uptime30: null });
    expect(byId.off!.status.state).toBe("paused");
  });

  it("reads every non-paused monitor as unknown when the last tick is 4 minutes old", async () => {
    const now = Date.now();
    await db.insert(t.monitors).values([monitorRow("a"), monitorRow("off", { paused: 1 })]);
    await seedSnapshot(now - 4 * 60_000, { a: { state: "up", lastCheckedAt: now - 4 * 60_000, latencyMs: 50 } });
    const list = (await (await call(cookie, "GET", "/monitors")).json()) as Monitor[];
    expect(list.find((m) => m.id === "a")!.status.state).toBe("unknown");
    expect(list.find((m) => m.id === "off")!.status.state).toBe("paused");
  });

  it("exposes lastBeatAt for heartbeats and a beat url", async () => {
    const now = Date.now();
    await db.insert(t.monitors).values(
      monitorRow("hb", { type: "heartbeat", url: null, heartbeatPeriodS: 300, heartbeatGraceS: 60, heartbeatToken: "tok" }),
    );
    await db.insert(t.heartbeats).values({ monitorId: "hb", lastBeatAt: now - 10_000 });
    await seedSnapshot(now, { hb: { state: "up", lastCheckedAt: now, latencyMs: null } });
    const [hb] = (await (await call(cookie, "GET", "/monitors")).json()) as Monitor[];
    expect(hb!.status.lastBeatAt).toBe(now - 10_000);
    expect(hb!.beatUrl).toContain("/beat/tok");
  });

  it("detail has 90 aligned bars and events with prevDurationS", async () => {
    const now = Date.now();
    await db.insert(t.monitors).values(monitorRow("a"));
    await seedSnapshot(now, {}, { a: [{ day: utcDay(now - DAY_MS), uptime: 1, downtimeS: 0, observedS: 86_400 }] });
    await db.insert(t.monitors).values(monitorRow("b"));
    await db.insert(t.events).values([
      { monitorId: "a", fromState: "pending", toState: "up", at: now - 3_600_000, reason: "ok" },
      { monitorId: "b", fromState: "pending", toState: "up", at: now - 3_000_000, reason: "ok" },
      { monitorId: "a", fromState: "up", toState: "down", at: now - 3_000_000 + 600_000, reason: "timeout" },
    ]);

    const res = await call(cookie, "GET", "/monitors/a");
    expect(res.status).toBe(200);
    const detail = (await res.json()) as MonitorDetail;
    expect(detail.bars).toHaveLength(90);
    expect(detail.bars[88]).toMatchObject({ day: utcDay(now - DAY_MS), uptime: 1 });
    expect(detail.events.map((e) => [e.monitorName, e.to, e.prevDurationS])).toEqual([
      ["a", "down", 1200],
      ["a", "up", null],
    ]);
    expect((await call(cookie, "GET", "/monitors/nope")).status).toBe(404);
  });

  it("returns status after create and patch", async () => {
    const created = await call(cookie, "POST", "/monitors", { name: "A", slug: "a", type: "http", url: "https://example.com", intervalMin: 5 });
    expect(created.status).toBe(201);
    const m = (await created.json()) as Monitor;
    expect(m.status.state).toBe("unknown"); // no tick yet
    const patched = await call(cookie, "PATCH", `/monitors/${m.id}`, { name: "B" });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as Monitor).status.state).toBe("unknown");
  });
});

describe("test check", () => {
  it("runs an http check and writes nothing to D1", async () => {
    await db.insert(t.monitors).values(monitorRow("a"));
    await seedSnapshot(Date.now());
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    const before = await rowCounts();
    const res = await call(cookie, "POST", "/monitors/a/check");
    expect(res.status).toBe(200);
    expect((await res.json()) as TestCheckResult).toMatchObject({ ok: true, code: 200, error: null });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await rowCounts()).toEqual(before);
  });

  it("reports a failing check as a result, not an error", async () => {
    await db.insert(t.monitors).values(monitorRow("a"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
    const body = (await (await call(cookie, "POST", "/monitors/a/check")).json()) as TestCheckResult;
    expect(body).toMatchObject({ ok: false, code: 503, error: "status" });
  });

  it("never fetches a private address even if one is stored", async () => {
    await db.insert(t.monitors).values(monitorRow("a", { url: "http://10.0.0.1/admin" }));
    const spy = vi.spyOn(globalThis, "fetch");
    const res = await call(cookie, "POST", "/monitors/a/check");
    expect(res.status).toBe(200);
    expect(((await res.json()) as TestCheckResult).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses heartbeats and unknown monitors", async () => {
    await db.insert(t.monitors).values(monitorRow("hb", { type: "heartbeat", url: null, heartbeatPeriodS: 60 }));
    const res = await call(cookie, "POST", "/monitors/hb/check");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_checkable" });
    expect((await call(cookie, "POST", "/monitors/nope/check")).status).toBe(404);
  });

  it("allows 6 checks a minute, the 7th is 429", async () => {
    await db.insert(t.monitors).values(monitorRow("a"));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok", { status: 200 }));
    for (let i = 0; i < 6; i++) expect((await call(cookie, "POST", "/monitors/a/check")).status).toBe(200);
    const res = await call(cookie, "POST", "/monitors/a/check");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too_many_checks" });
  });

  it("needs a session", async () => {
    const res = await call("", "POST", "/monitors/a/check");
    expect(res.status).toBe(401);
  });
});

describe("budget guard", () => {
  // D1 caps bound parameters per statement: insert one row at a time in a batch
  const seedFree = async (n: number) => {
    const [first, ...rest] = Array.from({ length: n }, (_, i) => db.insert(t.monitors).values(monitorRow(`m${i}`)));
    if (first) await db.batch([first, ...rest]);
  };
  const newMonitor = (slug: string, extra: Record<string, unknown> = {}) => ({
    name: slug,
    slug,
    type: "http",
    url: "https://example.com",
    intervalMin: 1,
    ...extra,
  });

  it("refuses the 41st one-minute monitor on free; heartbeats, rename and slower intervals pass", async () => {
    await seedFree(40);
    const res = await call(cookie, "POST", "/monitors", newMonitor("m40"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "budget_exceeded", used: 40, after: 41, budget: 40 });

    const hb = await call(cookie, "POST", "/monitors", {
      name: "hb", slug: "hb", type: "heartbeat", heartbeatPeriodS: 300, heartbeatGraceS: 60,
    });
    expect(hb.status).toBe(201);
    expect((await call(cookie, "PATCH", "/monitors/m0", { name: "renamed" })).status).toBe(200);
    // a paused monitor never counts
    expect((await call(cookie, "POST", "/monitors", newMonitor("paused", { paused: true }))).status).toBe(201);
  });

  it("refuses unpausing a monitor past the budget", async () => {
    await seedFree(40);
    await db.insert(t.monitors).values(monitorRow("off", { paused: 1 }));
    const res = await call(cookie, "PATCH", "/monitors/off", { paused: false });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "budget_exceeded", used: 40, after: 41, budget: 40 });
  });

  it("still saves edits in an install already over budget", async () => {
    await seedFree(41);
    const res = await call(cookie, "PATCH", "/monitors/m3", { name: "still ok", timeoutMs: 5000 });
    expect(res.status).toBe(200);
    // but not one that raises the peak further
    expect((await call(cookie, "POST", "/monitors", newMonitor("m41"))).status).toBe(409);
  });

  it("lifts the limit on the paid plan", async () => {
    await seedFree(40);
    expect((await call(cookie, "PATCH", "/settings", { plan: "paid" })).status).toBe(200);
    expect((await call(cookie, "POST", "/monitors", newMonitor("m40"))).status).toBe(201);
  });

  it("honours a lower custom budget", async () => {
    await seedFree(5);
    await call(cookie, "PATCH", "/settings", { checkBudget: 5 });
    expect((await call(cookie, "POST", "/monitors", newMonitor("m5"))).status).toBe(409);
  });
});

describe("groups and settings", () => {
  it("counts monitors per group", async () => {
    await db.insert(t.groups).values([
      { id: "g1", slug: "core", name: "Core", sort: 0 },
      { id: "g2", slug: "empty", name: "Empty", sort: 1 },
    ]);
    await db.insert(t.monitors).values([monitorRow("a", { groupId: "g1" }), monitorRow("b", { groupId: "g1" }), monitorRow("c")]);
    const list = (await (await call(cookie, "GET", "/groups")).json()) as Group[];
    expect(list.map((g) => [g.slug, g.monitorCount])).toEqual([["core", 2], ["empty", 0]]);
    const created = await call(cookie, "POST", "/groups", { slug: "new", name: "New" });
    expect(((await created.json()) as Group).monitorCount).toBe(0);
    const patched = await call(cookie, "PATCH", "/groups/g1", { name: "Core 2" });
    expect(((await patched.json()) as Group).monitorCount).toBe(2);
  });

  it("returns the effective budget and the peak checks per minute", async () => {
    await db.insert(t.monitors).values([monitorRow("a"), monitorRow("b"), monitorRow("c", { paused: 1 })]);
    const free = (await (await call(cookie, "GET", "/settings")).json()) as Settings;
    expect(free).toMatchObject({ plan: "free", checkBudget: null, effectiveBudget: 40, checksPerMinute: 2 });
    const paid = (await (await call(cookie, "PATCH", "/settings", { plan: "paid" })).json()) as Settings;
    expect(paid).toMatchObject({ plan: "paid", effectiveBudget: 500 });
    const custom = (await (await call(cookie, "PATCH", "/settings", { checkBudget: 100 })).json()) as Settings;
    expect(custom.effectiveBudget).toBe(100);
  });
});
