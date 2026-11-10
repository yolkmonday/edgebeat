import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLoginLimiter } from "@/api/admin/auth";
import type { runChecks } from "@/checks/run";
import type { PublicStatus } from "@/core/public-status";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import worker from "@/index";
import { runTick } from "@/tick/tick";

// admin API -> tick -> snapshot -> public status, end to end through real D1
const db = getDb(env);
const BASE = "https://upflare.test";
const STATUS = `${BASE}/api/v1/status`;
const MIN = 60_000;

const subrequestCaps: number[] = [];
const allOk: typeof runChecks = async (ms, o) => {
  subrequestCaps.push(o.subrequestBudget);
  return {
    results: ms.map((m) => ({ monitorId: m.id, ok: true, latencyMs: 50, code: 200, error: null })),
    notStarted: [],
  };
};

let cookie = "";
const admin = (method: string, path: string, body?: unknown) =>
  SELF.fetch(`${BASE}/api/admin${path}`, {
    method,
    headers: {
      cookie,
      origin: BASE,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const status = async (): Promise<PublicStatus> => {
  await caches.default.delete(new Request(STATUS));
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(STATUS), env, ctx);
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(200);
  return (await res.json()) as PublicStatus;
};
const stateOf = (s: PublicStatus, slug: string) =>
  s.groups.flatMap((g) => g.monitors).find((m) => m.slug === slug)?.state;

beforeEach(async () => {
  resetLoginLimiter();
  subrequestCaps.length = 0;
  await db.batch([
    db.delete(t.events),
    db.delete(t.ticks),
    db.delete(t.dailyStats),
    db.delete(t.snapshot),
    db.delete(t.settings),
    db.delete(t.heartbeats),
    db.delete(t.monitorState),
    db.delete(t.monitors),
    db.delete(t.groups),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("admin -> tick -> public status", () => {
  it("covers create, staleness, pause/unpause and plan budgets", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Math.floor(Date.now() / MIN) * MIN + 1_000;
    const atMin = (n: number) => t0 + n * MIN;
    vi.setSystemTime(t0);

    const login = await SELF.fetch(`${BASE}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
    });
    expect(login.status).toBe(204);
    cookie = login.headers.get("set-cookie")!.split(";")[0]!;

    const web = await admin("POST", "/monitors", { name: "Web", slug: "web", type: "http", url: "https://example.com" });
    expect(web.status).toBe(201);
    const hbRes = await admin("POST", "/monitors", {
      name: "Cron", slug: "cron", type: "heartbeat", heartbeatPeriodS: 300, heartbeatGraceS: 60,
    });
    const hb = (await hbRes.json()) as { id: string; beatUrl: string };

    // first tick: http up, never-beaten heartbeat stays pending
    expect(await runTick(env, atMin(0), { runChecks: allOk })).toMatchObject({ ran: true, checked: 1 });
    let s = await status();
    expect(s).toMatchObject({ stale: false, overall: "operational" });
    expect([stateOf(s, "web"), stateOf(s, "cron")]).toEqual(["up", "pending"]);

    // cron stops: 4 minutes later the same snapshot is stale and nothing reads green
    vi.setSystemTime(atMin(4));
    s = await status();
    expect(s).toMatchObject({ stale: true, overall: "unknown" });
    expect([stateOf(s, "web"), stateOf(s, "cron")]).toEqual(["unknown", "unknown"]);

    // a beat, then ticks resume
    expect((await SELF.fetch(hb.beatUrl)).status).toBe(200);
    await runTick(env, atMin(5), { runChecks: allOk });
    vi.setSystemTime(atMin(5));
    s = await status();
    expect(s.overall).toBe("operational");
    expect(stateOf(s, "cron")).toBe("up");

    // pause -> tick -> paused
    expect((await admin("PATCH", `/monitors/${hb.id}`, { paused: true })).status).toBe(200);
    await runTick(env, atMin(6), { runChecks: allOk });
    vi.setSystemTime(atMin(6));
    s = await status();
    expect(stateOf(s, "cron")).toBe("paused");
    expect(s.overall).toBe("operational");
    expect((await db.select().from(t.monitorState).where(eq(t.monitorState.monitorId, hb.id)))[0]!.state).toBe("paused");

    // unpause -> pending; heartbeat forgets its last beat, and stays pending through a tick
    expect((await admin("PATCH", `/monitors/${hb.id}`, { paused: false })).status).toBe(200);
    expect((await db.select().from(t.heartbeats).where(eq(t.heartbeats.monitorId, hb.id)))[0]!.lastBeatAt).toBeNull();
    expect(stateOf(await status(), "cron")).toBe("pending");
    await runTick(env, atMin(7), { runChecks: allOk });
    vi.setSystemTime(atMin(7));
    s = await status();
    expect(stateOf(s, "cron")).toBe("pending");
    expect((await db.select().from(t.monitorState).where(eq(t.monitorState.monitorId, hb.id)))[0]!.state).toBe("pending");
    const hbEvents = await db.select().from(t.events).where(eq(t.events.monitorId, hb.id)).orderBy(t.events.id);
    expect(hbEvents.map((e) => `${e.fromState}->${e.toState}`)).toEqual(["pending->up", "up->paused", "paused->pending"]);

    // plan budgets: 45 more 1-minute monitors -> 46 due
    const extra = Array.from({ length: 45 }, (_, i) =>
      db.insert(t.monitors).values({
        id: `x${String(i).padStart(2, "0")}`,
        slug: `x${i}`,
        name: `x${i}`,
        type: "http",
        url: "https://example.com",
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    await db.batch([extra[0]!, ...extra.slice(1)]);

    expect((await admin("PATCH", "/settings", { plan: "paid" })).status).toBe(200);
    expect(await runTick(env, atMin(8), { runChecks: allOk })).toMatchObject({ checked: 46, carried: 0 });

    expect((await admin("PATCH", "/settings", { plan: "free", checkBudget: 200 })).status).toBe(200);
    expect(await runTick(env, atMin(9), { runChecks: allOk })).toMatchObject({ checked: 40, carried: 6 });

    expect(subrequestCaps.slice(-2)).toEqual([1000, 44]);
  });
});
