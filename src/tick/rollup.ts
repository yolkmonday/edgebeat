import { and, eq, gt, gte, lt, sql } from "drizzle-orm";
import {
  addTickResults,
  downtimeSeconds,
  emptyDay,
  rollBars,
  utcDay,
  type Bar,
  type DayStats,
} from "@/core/stats";
import type { CheckResult, MonitorState } from "@/core/types";
import { getDb } from "@/db/client";
import { dailyStats, events, monitors, snapshot, ticks } from "@/db/schema";
import type { Env } from "@/env";
import { chunkRows, DAY_MS, isRecord, MIN_MS, parseJson, runBatch } from "@/tick/batch";

/** One stored tick result: [monitorId, ok ? 1 : 0, latencyMs, code]. */
export type TickEntry = [string, 0 | 1, number | null, number | null];

type Group = { monitorId: string; day: string; results: CheckResult[] };
type StateEvent = { monitorId: string; toState: MonitorState; at: number };

const DAILY_STATS_PARAMS = 7;

const toResult = ([monitorId, ok, latencyMs, code]: TickEntry): CheckResult => ({
  monitorId,
  ok: ok === 1,
  latencyMs,
  code,
  error: null,
});

const groupTicks = (rows: { minute: number; results: string }[], known: Set<string>): Group[] => {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const day = utcDay(row.minute * MIN_MS);
    for (const entry of parseJson<TickEntry[]>(row.results, [], Array.isArray)) {
      const r = toResult(entry);
      if (!known.has(r.monitorId)) continue;
      const key = `${r.monitorId}|${day}`;
      const g = groups.get(key) ?? { monitorId: r.monitorId, day, results: [] };
      g.results.push(r);
      groups.set(key, g);
    }
  }
  return [...groups.values()].sort((a, b) => a.day.localeCompare(b.day));
};

const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`);

const toDayStats = (row: typeof dailyStats.$inferSelect | undefined): DayStats => {
  const base = emptyDay();
  if (!row) return base;
  const hist = parseJson<number[]>(row.hist, base.hist, (v) => Array.isArray(v) && v.length === base.hist.length);
  return { checks: row.checks, failures: row.failures, downtimeS: row.downtimeS, observedS: row.observedS, hist };
};

/** State at `from`: the latest event strictly before it, else `pending`. */
const stateAt = (evs: StateEvent[], from: number): MonitorState =>
  evs.filter((e) => e.at < from).reduce<StateEvent | null>((last, e) => (!last || e.at >= last.at ? e : last), null)
    ?.toState ?? "pending";

export const runRollup = async (env: Env, now: number): Promise<void> => {
  const db = getDb(env);
  const [snap] = await db
    .select({ bars: snapshot.bars, lastRollupMinute: snapshot.lastRollupMinute })
    .from(snapshot)
    .where(eq(snapshot.id, 1));
  if (!snap) return;

  const [tickRows, monitorRows] = await db.batch([
    db.select().from(ticks).where(gt(ticks.minute, snap.lastRollupMinute)).orderBy(ticks.minute),
    db.select({ id: monitors.id, intervalMin: monitors.intervalMin }).from(monitors),
  ]);
  if (tickRows.length === 0) return;

  const intervals = new Map(monitorRows.map((m) => [m.id, m.intervalMin]));
  const groups = groupTicks(tickRows, new Set(intervals.keys()));
  const lastMinute = tickRows[tickRows.length - 1]!.minute;
  const today = utcDay(now);
  // days the previous rollup may have left open (downtime counted only up to that rollup's "now")
  const prevDay = snap.lastRollupMinute > 0 ? utcDay(snap.lastRollupMinute * MIN_MS) : null;
  const openDay = prevDay !== null && prevDay < today ? prevDay : null;
  const lowDay = [openDay, groups[0]?.day].filter((d) => d != null).sort()[0];

  const bars = parseJson<Record<string, Bar[]>>(snap.bars, {}, isRecord);
  const nextBars: Record<string, Bar[]> = Object.fromEntries(
    Object.entries(bars).filter(([id]) => intervals.has(id)),
  );
  const statRows: (typeof dailyStats.$inferInsert)[] = [];

  if (lowDay !== undefined) {
    const from = dayStart(lowDay);
    const [existing, windowEvents, priorEvents] = await db.batch([
      db.select().from(dailyStats).where(gte(dailyStats.day, lowDay)),
      db
        .select({ monitorId: events.monitorId, toState: events.toState, at: events.at })
        .from(events)
        .where(and(gte(events.at, from), lt(events.at, now)))
        .orderBy(events.at, events.id),
      // SQLite returns the bare columns of the max(at) row per group
      db
        .select({ monitorId: events.monitorId, toState: events.toState, at: sql<number>`max(${events.at})` })
        .from(events)
        .where(lt(events.at, from))
        .groupBy(events.monitorId),
    ]);

    const statsByKey = new Map(existing.map((r) => [`${r.monitorId}|${r.day}`, r]));
    const folded = new Set(groups.map((g) => `${g.monitorId}|${g.day}`));
    // ended days with stats but no new ticks: recompute downtime through day end (idempotent)
    const finalize: Group[] =
      openDay === null
        ? []
        : existing
            .filter((r) => r.day >= openDay && r.day < today && intervals.has(r.monitorId))
            .filter((r) => !folded.has(`${r.monitorId}|${r.day}`))
            .map((r) => ({ monitorId: r.monitorId, day: r.day, results: [] }));
    const eventsOf = (id: string): StateEvent[] => [
      ...priorEvents.filter((e) => e.monitorId === id),
      ...windowEvents.filter((e) => e.monitorId === id),
    ];

    for (const g of [...groups, ...finalize].sort((a, b) => a.day.localeCompare(b.day))) {
      const start = dayStart(g.day);
      const end = Math.max(start, Math.min(start + DAY_MS, now));
      const evs = eventsOf(g.monitorId);
      const inDay = evs.filter((e) => e.at >= start && e.at < end);
      const added = addTickResults(toDayStats(statsByKey.get(`${g.monitorId}|${g.day}`)), g.results, intervals.get(g.monitorId)!);
      const stats: DayStats = { ...added, downtimeS: downtimeSeconds(inDay, stateAt(evs, start), start, end) };
      statRows.push({ monitorId: g.monitorId, day: g.day, ...stats, hist: JSON.stringify(stats.hist) });
      nextBars[g.monitorId] = rollBars(nextBars[g.monitorId] ?? [], g.day, stats);
    }
  }

  await runBatch(db, [
    ...chunkRows(statRows, DAILY_STATS_PARAMS).map((rows) =>
      db
        .insert(dailyStats)
        .values(rows)
        .onConflictDoUpdate({
          target: [dailyStats.monitorId, dailyStats.day],
          set: {
            checks: sql`excluded.checks`,
            failures: sql`excluded.failures`,
            downtimeS: sql`excluded.downtime_s`,
            observedS: sql`excluded.observed_s`,
            hist: sql`excluded.hist`,
          },
        }),
    ),
    db
      .update(snapshot)
      .set({ bars: JSON.stringify(nextBars), lastRollupMinute: lastMinute })
      .where(eq(snapshot.id, 1)),
  ]);
};
