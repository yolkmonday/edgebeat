import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { runChecks } from "@/checks/run";
import type { RunnableMonitor } from "@/checks/run";
import type { CheckResult } from "@/core/types";
import { slotOf } from "@/core/schedule";
import { utcDay, type Bar } from "@/core/stats";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { runRollup } from "@/tick/rollup";
import { runTick } from "@/tick/tick";

const db = getDb(env);
const MIN = 60_000;
// 2026-11-09T00:00:00Z as an epoch minute (multiple of 1440, so of 15 and 60)
const DAY0 = Date.UTC(2026, 10, 9) / MIN;
const at = (minute: number): number => minute * MIN;

type Script = (id: string, call: number) => Omit<CheckResult, "monitorId">;

const fakeRunner = (script: Script) => {
  const calls: string[][] = [];
  const fn: typeof runChecks = async (ms: RunnableMonitor[]) => {
    const call = calls.length;
    calls.push(ms.map((m) => m.id));
    return { results: ms.map((m) => ({ monitorId: m.id, ...script(m.id, call) })), notStarted: [] };
  };
  return { fn, calls };
};

const ok = (latencyMs = 120): Omit<CheckResult, "monitorId"> => ({ ok: true, latencyMs, code: 200, error: null });
const fail: Omit<CheckResult, "monitorId"> = { ok: false, latencyMs: 80, code: 503, error: "status" };

const httpMonitor = (id: string, extra: Partial<typeof t.monitors.$inferInsert> = {}) => ({
  id,
  slug: id,
  name: id,
  type: "http" as const,
  url: `https://example.com/${id}`,
  intervalMin: 1,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const readSnapshot = async () => {
  const [row] = await db.select().from(t.snapshot).where(eq(t.snapshot.id, 1));
  return row!;
};

beforeEach(async () => {
  await db.batch([
    db.delete(t.events),
    db.delete(t.ticks),
    db.delete(t.dailyStats),
    db.delete(t.snapshot),
    db.delete(t.settings),
    db.delete(t.heartbeats),
    db.delete(t.monitorState),
    db.delete(t.monitors),
  ]);
});

describe("runTick", () => {
  it("lets only one of two concurrent ticks run", async () => {
    await db.insert(t.monitors).values(httpMonitor("a"));
    const { fn } = fakeRunner(() => ok());
    const now = at(DAY0 + 1);
    const [r1, r2] = await Promise.all([
      runTick(env, now, { runChecks: fn }),
      runTick(env, now, { runChecks: fn }),
    ]);
    expect([r1.ran, r2.ran].filter(Boolean)).toHaveLength(1);
    const skipped = r1.ran ? r2 : r1;
    expect(skipped).toEqual({ ran: false, checked: 0, carried: 0, transitions: [], stateWrites: 0 });
  });

  it("runs at most once per minute even after the lock is released", async () => {
    await db.insert(t.monitors).values(httpMonitor("a"));
    const { fn, calls } = fakeRunner(() => ok());
    expect((await runTick(env, at(DAY0 + 1), { runChecks: fn })).ran).toBe(true);
    expect((await runTick(env, at(DAY0 + 1) + 30_000, { runChecks: fn })).ran).toBe(false);
    expect((await runTick(env, at(DAY0 + 2), { runChecks: fn })).ran).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("goes up -> down after two failures with confirmations 2", async () => {
    await db.insert(t.monitors).values(httpMonitor("a", { confirmations: 2 }));
    const { fn } = fakeRunner((_id, call) => (call === 0 ? ok() : fail));
    const t1 = at(DAY0 + 1);
    const t2 = at(DAY0 + 2);
    const t3 = at(DAY0 + 3);

    const r1 = await runTick(env, t1, { runChecks: fn });
    expect(r1.transitions).toEqual([{ monitorId: "a", from: "pending", to: "up", at: t1, error: null }]);
    const r2 = await runTick(env, t2, { runChecks: fn });
    expect(r2.transitions).toEqual([]);
    const r3 = await runTick(env, t3, { runChecks: fn });
    expect(r3.transitions).toEqual([{ monitorId: "a", from: "up", to: "down", at: t3, error: "status" }]);

    const downs = await db.select().from(t.events).where(eq(t.events.toState, "down"));
    expect(downs).toHaveLength(1);
    expect(downs[0]).toMatchObject({ monitorId: "a", fromState: "up", at: t3 });
    const [state] = await db.select().from(t.monitorState).where(eq(t.monitorState.monitorId, "a"));
    expect(state).toMatchObject({ state: "down", consecutiveFailures: 2, lastChangeAt: t3 });

    const snap = await readSnapshot();
    expect(JSON.parse(snap.current)).toEqual({ a: { state: "down", lastCheckedAt: t3, latencyMs: 80 } });
    expect(snap.lockUntil).toBe(0);
    expect(snap.lastTickAt).toBe(t3);
  });

  it("does not rewrite monitor_state for a monitor that stays down", async () => {
    await db.insert(t.monitors).values(httpMonitor("a", { confirmations: 2 }));
    const { fn } = fakeRunner(() => fail);
    const writes: number[] = [];
    for (const m of [1, 2, 3]) writes.push((await runTick(env, at(DAY0 + m), { runChecks: fn })).stateWrites);
    expect(writes).toEqual([1, 1, 0]);
    const [state] = await db.select().from(t.monitorState);
    expect(state).toMatchObject({ state: "down", consecutiveFailures: 2, lastChangeAt: at(DAY0 + 2) });
  });

  it("writes monitor_state once for a steady OK monitor over 3 ticks", async () => {
    await db.insert(t.monitors).values(httpMonitor("a"));
    const { fn } = fakeRunner(() => ok());
    const t1 = at(DAY0 + 1);
    const writes: number[] = [];
    for (const m of [1, 2, 3]) {
      const r = await runTick(env, at(DAY0 + m), { runChecks: fn });
      expect(r.ran).toBe(true);
      writes.push(r.stateWrites);
    }
    expect(writes).toEqual([1, 0, 0]);
    const [state] = await db.select().from(t.monitorState);
    expect(state).toMatchObject({ monitorId: "a", state: "up", consecutiveFailures: 0, lastChangeAt: t1 });
    expect(await db.select().from(t.ticks)).toHaveLength(3);
  });

  it("checks 40 of 45 due monitors on the free plan and carries the rest first", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `m${String(i).padStart(2, "0")}`);
    // one row per statement: each monitor row binds ~18 params (D1 caps a statement at 100)
    const [first, ...rest] = ids.map((id) => db.insert(t.monitors).values(httpMonitor(id)));
    await db.batch([first!, ...rest]);
    const { fn, calls } = fakeRunner(() => ok());

    const r1 = await runTick(env, at(DAY0 + 1), { runChecks: fn });
    expect(r1).toMatchObject({ ran: true, checked: 40, carried: 5, stateWrites: 40 });
    expect(r1.transitions).toHaveLength(40);
    expect(await db.select().from(t.events)).toHaveLength(40);
    const carried = ids.slice(40);
    expect(JSON.parse((await readSnapshot()).carry)).toEqual(carried);

    const r2 = await runTick(env, at(DAY0 + 2), { runChecks: fn });
    expect(r2).toMatchObject({ ran: true, checked: 40, carried: 5 });
    expect(calls[1]!.slice(0, 5)).toEqual(carried);
  });

  it("passes the plan's subrequest cap and clamps a free override to 40", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `m${String(i).padStart(2, "0")}`);
    const [first, ...rest] = ids.map((id) => db.insert(t.monitors).values(httpMonitor(id)));
    await db.batch([first!, ...rest]);
    const caps: number[] = [];
    const fn: typeof runChecks = async (ms, o) => {
      caps.push(o.subrequestBudget);
      return { results: ms.map((m) => ({ monitorId: m.id, ...ok() })), notStarted: [] };
    };
    await db.insert(t.settings).values({ key: "checkBudget", value: "200" });
    expect(await runTick(env, at(DAY0 + 1), { runChecks: fn })).toMatchObject({ checked: 40, carried: 5 });
    await db.insert(t.settings).values({ key: "plan", value: JSON.stringify("paid") });
    expect(await runTick(env, at(DAY0 + 2), { runChecks: fn })).toMatchObject({ checked: 45, carried: 0 });
    expect(caps).toEqual([44, 1000]);
  });

  it("reports a late heartbeat as heartbeat_late", async () => {
    const now = at(DAY0 + 1);
    await db.insert(t.monitors).values({
      ...httpMonitor("hb", { type: "heartbeat", url: null, confirmations: 1 }),
      heartbeatPeriodS: 60,
      heartbeatGraceS: 30,
    });
    await db.insert(t.heartbeats).values({ monitorId: "hb", lastBeatAt: now - 100_000, lastFailAt: null });
    const { fn, calls } = fakeRunner(() => ok());

    const r = await runTick(env, now, { runChecks: fn });
    expect(r.transitions).toEqual([{ monitorId: "hb", from: "pending", to: "down", at: now, error: "heartbeat_late" }]);
    expect(calls.flat()).not.toContain("hb");
    const [tick] = await db.select().from(t.ticks);
    expect(JSON.parse(tick!.results)).toEqual([["hb", 0, null, null]]);
  });

  it("leaves a never-beaten heartbeat out of results and evaluation", async () => {
    const now = at(DAY0 + 1);
    await db.insert(t.monitors).values({
      ...httpMonitor("hb", { type: "heartbeat", url: null }),
      heartbeatPeriodS: 60,
      heartbeatGraceS: 30,
    });
    await db.insert(t.heartbeats).values({ monitorId: "hb", lastBeatAt: null, lastFailAt: null });
    const { fn } = fakeRunner(() => ok());

    const r = await runTick(env, now, { runChecks: fn });
    expect(r).toMatchObject({ ran: true, stateWrites: 0, transitions: [] });
    expect(await db.select().from(t.monitorState)).toHaveLength(0);
    const [tick] = await db.select().from(t.ticks);
    expect(JSON.parse(tick!.results)).toEqual([]);
  });
});

describe("runRollup", () => {
  it("folds 15 OK ticks into daily_stats and today's bar; no bar for a monitor without ticks", async () => {
    await db.insert(t.monitors).values([
      httpMonitor("a"),
      // created today, never beaten: produces no tick results
      { ...httpMonitor("hb", { type: "heartbeat", url: null }), heartbeatPeriodS: 60, heartbeatGraceS: 30 },
    ]);
    const { fn } = fakeRunner(() => ok());
    // minutes DAY0+61 .. DAY0+75; the last one is a multiple of 15 and triggers the rollup
    for (let m = 61; m <= 75; m++) await runTick(env, at(DAY0 + m), { runChecks: fn });

    const today = utcDay(at(DAY0));
    const [stats] = await db.select().from(t.dailyStats).where(eq(t.dailyStats.monitorId, "a"));
    expect(stats).toMatchObject({ day: today, checks: 15, failures: 0, observedS: 900, downtimeS: 0 });

    const snap = await readSnapshot();
    expect(snap.lastRollupMinute).toBe(DAY0 + 75);
    const bars = JSON.parse(snap.bars) as Record<string, Bar[]>;
    expect(bars.a).toEqual([{ day: today, uptime: 1, downtimeS: 0, observedS: 900 }]);
    expect(bars.hb).toBeUndefined();
    expect(await db.select().from(t.dailyStats).where(eq(t.dailyStats.monitorId, "hb"))).toHaveLength(0);
  });

  it("counts downtime from events within the day", async () => {
    await db.insert(t.monitors).values(httpMonitor("a", { confirmations: 1 }));
    // up for minutes 1..5, down from minute 6 on
    const { fn } = fakeRunner((_id, call) => (call < 5 ? ok() : fail));
    for (let m = 1; m <= 15; m++) await runTick(env, at(DAY0 + m), { runChecks: fn });

    const [stats] = await db.select().from(t.dailyStats);
    expect(stats).toMatchObject({ checks: 15, failures: 10, observedS: 900 });
    // down from minute 6 to now (minute 15) = 9 minutes
    expect(stats!.downtimeS).toBe(540);
  });

  it("writes nothing when there are no new ticks", async () => {
    await db.insert(t.monitors).values(httpMonitor("a"));
    const bars = JSON.stringify({ a: [{ day: utcDay(at(DAY0)), uptime: 1, downtimeS: 0, observedS: 600 }] });
    await db.insert(t.snapshot).values({
      id: 1,
      lastTickAt: at(DAY0 + 10),
      lockUntil: 0,
      current: "{}",
      bars,
      carry: "[]",
      lastRollupMinute: DAY0 + 10,
    });
    // already folded: minute <= lastRollupMinute
    await db.insert(t.ticks).values({ minute: DAY0 + 10, at: at(DAY0 + 10), results: JSON.stringify([["a", 1, 100, 200]]) });

    await runRollup(env, at(DAY0 + 15));

    expect(await db.select().from(t.dailyStats)).toHaveLength(0);
    const snaps = await db.select().from(t.snapshot);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ bars, lastRollupMinute: DAY0 + 10 });
  });

  it("finalizes the previous day's downtime through day end for a 60-minute monitor", async () => {
    await db.insert(t.monitors).values(httpMonitor("a", { intervalMin: 60, confirmations: 1 }));
    const s = slotOf("a", 60);
    const { fn } = fakeRunner(() => fail);
    const downAt = DAY0 + 22 * 60 + s;
    await runTick(env, at(downAt), { runChecks: fn });
    await runTick(env, at(DAY0 + 23 * 60 + s), { runChecks: fn });
    // rollup during day d: folds both ticks, downtime counted up to "now" only
    await runRollup(env, at(DAY0 + 23 * 60 + s));
    // first tick of day d+1, then a rollup in day d+1 with no more ticks for day d
    await runTick(env, at(DAY0 + 1440 + s), { runChecks: fn });
    await runRollup(env, at(DAY0 + 1440 + s));

    const dayD = utcDay(at(DAY0));
    const dayNext = utcDay(at(DAY0 + 1440));
    const rows = await db.select().from(t.dailyStats).where(eq(t.dailyStats.monitorId, "a"));
    const d = rows.find((r) => r.day === dayD)!;
    expect(d).toMatchObject({ checks: 2, failures: 2, observedS: 7200 });
    expect(d.downtimeS).toBe((1440 - (22 * 60 + s)) * 60);
    const next = rows.find((r) => r.day === dayNext)!;
    expect(next).toMatchObject({ checks: 1, observedS: 3600, downtimeS: s * 60 });

    const bars = JSON.parse((await readSnapshot()).bars) as Record<string, Bar[]>;
    expect(bars.a!.map((b) => [b.day, b.downtimeS])).toEqual([
      [dayD, d.downtimeS],
      [dayNext, s * 60],
    ]);
  });
});
