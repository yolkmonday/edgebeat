import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { runChecks as defaultRunChecks, type RunnableMonitor } from "@/checks/run";
import { evaluate, type PrevState } from "@/core/evaluate";
import { checkBudget, isDue, selectChecks } from "@/core/schedule";
import { utcDay } from "@/core/stats";
import type { CheckResult, CurrentEntry, ErrorClass, MonitorState } from "@/core/types";
import { getDb } from "@/db/client";
import { dailyStats, events, heartbeats, monitors, monitorState, settings, snapshot, ticks } from "@/db/schema";
import type { Env } from "@/env";
import { chunkRows, DAY_MS, isRecord, MIN_MS, parseJson, runBatch } from "@/tick/batch";
import { runRollup, type TickEntry } from "@/tick/rollup";

const LOCK_MS = 55_000;
const DEADLINE_MS = 50_000;
const CONCURRENCY = 6;
const RETRY_BUDGET = 4;
// free: 40 checks + 4 retries (6 of the 50 stay reserved for alerts); paid limit is far higher
const SUBREQUEST_BUDGET = { free: 44, paid: 1000 } as const;
const TICK_RETENTION_MIN = 7 * 1440;
const STATS_RETENTION_DAYS = 400;
const STATE_PARAMS = 4; // monitorId, state, consecutiveFailures, lastChangeAt
const EVENT_PARAMS = 5; // monitorId, fromState, toState, at, reason (id is a literal null)

export type Transition = {
  monitorId: string;
  from: MonitorState;
  to: MonitorState;
  at: number;
  error: ErrorClass | null;
};

export type TickResult = {
  ran: boolean;
  checked: number;
  carried: number;
  transitions: Transition[];
  /** monitor_state rows upserted in this tick's batch */
  stateWrites: number;
};

export type { CurrentEntry };

type Deps = { runChecks?: typeof defaultRunChecks };
type Db = ReturnType<typeof getDb>;
type MonitorRow = typeof monitors.$inferSelect;
type HeartbeatRow = typeof heartbeats.$inferSelect;
type StateRow = typeof monitorState.$inferSelect;

const notRan = (): TickResult => ({ ran: false, checked: 0, carried: 0, transitions: [], stateWrites: 0 });

/** Ensures snapshot row 1 exists, then takes the lock: at most one tick per minute, none overlapping. */
const acquireLock = async (db: Db, now: number): Promise<boolean> => {
  const minuteStart = Math.floor(now / MIN_MS) * MIN_MS;
  const [, update] = await db.batch([
    db
      .insert(snapshot)
      .values({ id: 1, lastTickAt: 0, lockUntil: 0, current: "{}", bars: "{}", carry: "[]", lastRollupMinute: 0 })
      .onConflictDoNothing(),
    db
      .update(snapshot)
      .set({ lockUntil: now + LOCK_MS })
      .where(and(eq(snapshot.id, 1), lt(snapshot.lockUntil, now), lt(snapshot.lastTickAt, minuteStart))),
  ]);
  return update.meta.changes > 0;
};

const readState = (db: Db) =>
  db.batch([
    db.select().from(monitors),
    db.select().from(monitorState),
    // never the ~250 KB bars column: the tick only needs current and carry
    db.select({ current: snapshot.current, carry: snapshot.carry }).from(snapshot).where(eq(snapshot.id, 1)),
    db.select().from(settings).where(inArray(settings.key, ["plan", "checkBudget"])),
    db.select().from(heartbeats),
  ]);

const budgetFrom = (rows: { key: string; value: string }[]): { checks: number; subrequests: number } => {
  const value = (key: string): unknown => {
    const row = rows.find((r) => r.key === key);
    return row ? parseJson<unknown>(row.value, row.value, () => true) : undefined;
  };
  const plan = value("plan") === "paid" ? "paid" : "free";
  const override = value("checkBudget");
  const valid = typeof override === "number" && Number.isInteger(override) && override > 0;
  return { checks: checkBudget(plan, valid ? override : undefined), subrequests: SUBREQUEST_BUDGET[plan] };
};

const toRunnable = (m: MonitorRow): RunnableMonitor | null => {
  if (m.type === "http" && m.url) {
    return {
      type: "http",
      id: m.id,
      url: m.url,
      method: m.method,
      headers: parseJson<Record<string, string>>(m.headers, {}, isRecord),
      body: m.body,
      expectedStatus: m.expectedStatus,
      timeoutMs: m.timeoutMs,
      followRedirects: m.followRedirects !== 0,
      keyword: m.keyword,
      keywordMode: m.keywordMode,
    };
  }
  if (m.type === "tcp" && m.host && m.port !== null) {
    return { type: "tcp", id: m.id, host: m.host, port: m.port, timeoutMs: m.timeoutMs };
  }
  return null;
};

/** Null for a heartbeat that never beat (stays pending) or lacks a period. */
const heartbeatResult = (m: MonitorRow, hb: HeartbeatRow | undefined, now: number): CheckResult | null => {
  const lastBeatAt = hb?.lastBeatAt ?? null;
  if (lastBeatAt === null || m.heartbeatPeriodS === null) return null;
  const base = { monitorId: m.id, latencyMs: null, code: null };
  if (hb?.lastFailAt != null && hb.lastFailAt > lastBeatAt) return { ...base, ok: false, error: "heartbeat_fail" };
  const late = now - lastBeatAt > (m.heartbeatPeriodS + (m.heartbeatGraceS ?? 0)) * 1000;
  return late ? { ...base, ok: false, error: "heartbeat_late" } : { ...base, ok: true, error: null };
};

type Decisions = {
  stateRows: StateRow[];
  eventRows: (typeof events.$inferInsert)[];
  transitions: Transition[];
  current: Record<string, CurrentEntry>;
};

const decide = (
  results: CheckResult[],
  byId: Map<string, MonitorRow>,
  states: Map<string, StateRow>,
  prevCurrent: Record<string, CurrentEntry>,
  now: number,
): Decisions => {
  // deleted and paused monitors leave current: an unpaused monitor reads pending until its next check
  const current = Object.fromEntries(
    Object.entries(prevCurrent).filter(([id]) => byId.has(id) && byId.get(id)!.paused === 0),
  );
  const out: Decisions = { stateRows: [], eventRows: [], transitions: [], current };
  for (const r of results) {
    const m = byId.get(r.monitorId);
    if (!m) continue;
    const row = states.get(r.monitorId);
    const prev: PrevState = row ?? { state: "pending", consecutiveFailures: 0 };
    const { next, changed, transition } = evaluate(prev, r, {
      confirmations: m.confirmations,
      degradedThresholdMs: m.degradedThresholdMs,
      inMaintenance: false,
      paused: false,
    });
    current[r.monitorId] = { state: next.state, lastCheckedAt: now, latencyMs: r.latencyMs };
    if (!changed && row) continue;
    out.stateRows.push({ monitorId: r.monitorId, ...next, lastChangeAt: transition || !row ? now : row.lastChangeAt });
    if (!transition) continue;
    out.transitions.push({ monitorId: r.monitorId, ...transition, at: now, error: r.error });
    out.eventRows.push({ monitorId: r.monitorId, fromState: transition.from, toState: transition.to, at: now, reason: r.error ?? "ok" });
  }
  return out;
};

const writeStatements = (
  db: Db,
  now: number,
  epochMinute: number,
  results: CheckResult[],
  d: Decisions,
  carry: string[],
) => {
  const entries: TickEntry[] = results.map((r) => [r.monitorId, r.ok ? 1 : 0, r.latencyMs, r.code]);
  const prune =
    epochMinute % 60 === 0
      ? [
          db.delete(ticks).where(lt(ticks.minute, epochMinute - TICK_RETENTION_MIN)),
          db.delete(dailyStats).where(lt(dailyStats.day, utcDay(now - STATS_RETENTION_DAYS * DAY_MS))),
        ]
      : [];
  return [
    db
      .insert(ticks)
      .values({ minute: epochMinute, at: now, results: JSON.stringify(entries) })
      .onConflictDoUpdate({ target: ticks.minute, set: { at: sql`excluded.at`, results: sql`excluded.results` } }),
    ...chunkRows(d.stateRows, STATE_PARAMS).map((rows) =>
      db
        .insert(monitorState)
        .values(rows)
        .onConflictDoUpdate({
          target: monitorState.monitorId,
          set: {
            state: sql`excluded.state`,
            consecutiveFailures: sql`excluded.consecutive_failures`,
            lastChangeAt: sql`excluded.last_change_at`,
          },
        }),
    ),
    ...chunkRows(d.eventRows, EVENT_PARAMS).map((rows) => db.insert(events).values(rows)),
    db
      .update(snapshot)
      .set({ current: JSON.stringify(d.current), carry: JSON.stringify(carry), lastTickAt: now, lockUntil: 0 })
      .where(eq(snapshot.id, 1)),
    ...prune,
  ];
};

export const runTick = async (env: Env, now: number, deps: Deps = {}): Promise<TickResult> => {
  const db = getDb(env);
  if (!(await acquireLock(db, now))) return notRan();

  const epochMinute = Math.floor(now / MIN_MS);
  const [monitorRows, stateRows, [snap], settingRows, heartbeatRows] = await readState(db);
  const active = monitorRows.filter((m) => m.paused === 0);
  const byId = new Map(monitorRows.map((m) => [m.id, m]));

  const prevCarry = parseJson<string[]>(snap?.carry ?? "[]", [], Array.isArray);
  const budget = budgetFrom(settingRows);
  const selected = selectChecks(active, prevCarry, epochMinute, budget.checks);
  const runnable = selected.run.map((id) => toRunnable(byId.get(id)!)).filter((m) => m !== null);
  const run = deps.runChecks ?? defaultRunChecks;
  const checks = await run(runnable, {
    concurrency: CONCURRENCY,
    retryBudget: RETRY_BUDGET,
    deadlineAt: now + DEADLINE_MS,
    now: Date.now,
    subrequestBudget: budget.subrequests,
  });

  const beats = new Map(heartbeatRows.map((h) => [h.monitorId, h]));
  const beatResults = active
    .filter((m) => m.type === "heartbeat" && isDue(m, epochMinute))
    .map((m) => heartbeatResult(m, beats.get(m.id), now))
    .filter((r) => r !== null);

  const results = [...checks.results, ...beatResults];
  const prevCurrent = parseJson<Record<string, CurrentEntry>>(snap?.current ?? "{}", {}, isRecord);
  const decisions = decide(results, byId, new Map(stateRows.map((s) => [s.monitorId, s])), prevCurrent, now);
  const carry = [...selected.carry, ...checks.notStarted];

  await runBatch(db, writeStatements(db, now, epochMinute, results, decisions, carry));
  if (epochMinute % 15 === 0) await runRollup(env, now);

  return {
    ran: true,
    checked: checks.results.length,
    carried: carry.length,
    transitions: decisions.transitions,
    stateWrites: decisions.stateRows.length,
  };
};
