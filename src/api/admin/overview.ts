import { eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@/env";
import { effectiveBudget, peakChecksPerMinute } from "@/core/budget";
import { monitorStateAt } from "@/core/public-status";
import { estimateWritesToday } from "@/core/usage";
import { getDb } from "@/db/client";
import { events, monitors, settings, snapshot, ticks } from "@/db/schema";
import { fetchUsage } from "@/lib/cf-analytics";
import { eventsQuery, toStateEvent } from "@/api/admin/event-rows";
import { readSnapshot } from "@/api/admin/monitor-status";
import { parseStored } from "@/api/admin/settings";
import type { AdminState, Overview } from "@/shared/admin-api";
import { DAY_MS, MIN_MS } from "@/tick/batch";

export const overviewApi = new Hono<{ Bindings: Env }>();

const FREE_LIMIT = 100_000;
const RECENT_DAYS = 7;
const RECENT_MAX = 5;

const emptyCounts = (): Record<AdminState, number> => ({
  up: 0,
  degraded: 0,
  down: 0,
  maintenance: 0,
  paused: 0,
  pending: 0,
  unknown: 0,
});

overviewApi.get("/", async (c) => {
  const now = Date.now();
  const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const db = getDb(c.env);
  const [monitorRows, [snap], settingRows, [tickCount], [eventCount], recent] = await db.batch([
    db.select().from(monitors),
    // never the ~250 KB bars column
    db.select({ lastTickAt: snapshot.lastTickAt, current: snapshot.current }).from(snapshot).where(eq(snapshot.id, 1)),
    db.select().from(settings),
    db.select({ n: sql<number>`count(*)` }).from(ticks).where(gte(ticks.minute, dayStart / MIN_MS)),
    db.select({ n: sql<number>`count(*)` }).from(events).where(gte(events.at, dayStart)),
    eventsQuery(db, { since: now - RECENT_DAYS * DAY_MS }, RECENT_MAX),
  ]);

  const view = readSnapshot(snap, now);
  const stored = parseStored(settingRows);

  const counts = emptyCounts();
  for (const m of monitorRows) {
    counts[monitorStateAt({ intervalMin: m.intervalMin, paused: m.paused === 1 }, view.current[m.id], now, view.stale)] += 1;
  }
  const checks = monitorRows.filter((m) => m.type !== "heartbeat");
  const heartbeatRows = monitorRows.filter((m) => m.type === "heartbeat");

  const limit = stored.plan === "free" ? FREE_LIMIT : null;
  const minutesElapsed = Math.floor((now - dayStart) / MIN_MS);
  const analytics = await fetchUsage(c.env, now);
  const estimate = estimateWritesToday({
    minutesElapsed,
    ticksToday: tickCount?.n ?? 0,
    activeChecked: checks.filter((m) => m.paused === 0).length,
    eventsToday: eventCount?.n ?? 0,
    heartbeatPeriodsS: heartbeatRows.filter((m) => m.paused === 0 && m.heartbeatPeriodS).map((m) => m.heartbeatPeriodS!),
  });

  const body: Overview = {
    now,
    tick: { lastTickAt: view.lastTickAt, stale: view.stale },
    counts,
    totals: { all: monitorRows.length, checks: checks.length, heartbeats: heartbeatRows.length },
    usage: {
      checksPerMinute: {
        used: peakChecksPerMinute(monitorRows.map((m) => ({ ...m, paused: m.paused === 1 }))),
        budget: effectiveBudget(stored.plan, stored.checkBudget),
        plan: stored.plan,
      },
      d1WritesToday: analytics
        ? {
            value: analytics.d1Writes,
            projected: Math.round((analytics.d1Writes * 1440) / Math.max(minutesElapsed, 15)),
            limit,
            source: "analytics",
          }
        : { ...estimate, limit, source: "estimate" },
      requestsToday: analytics ? { value: analytics.requests, limit } : null,
    },
    recentEvents: recent.map(toStateEvent),
  };
  return c.json(body);
});
