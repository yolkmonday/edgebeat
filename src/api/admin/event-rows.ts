import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events, monitors } from "@/db/schema";
import type { StateEvent } from "@/shared/admin-api";

type Db = ReturnType<typeof getDb>;
type Filter = { monitorId?: string; before?: number; since?: number };

// timestamp of the previous event of the same monitor; the gap is the time spent in `from`
const prevAt = sql<number | null>`(select e2.at from events e2 where e2.monitor_id = ${events.monitorId} and e2.id < ${events.id} order by e2.id desc limit 1)`;

/** Events newest id first, joined with monitor name/type. Usable alone or inside `db.batch`. */
export const eventsQuery = (db: Db, f: Filter, limit: number) => {
  const where: SQL[] = [];
  if (f.monitorId) where.push(eq(events.monitorId, f.monitorId));
  if (f.before !== undefined) where.push(lt(events.id, f.before));
  if (f.since !== undefined) where.push(gte(events.at, f.since));
  return db
    .select({
      id: events.id,
      monitorId: events.monitorId,
      monitorName: monitors.name,
      monitorType: monitors.type,
      from: events.fromState,
      to: events.toState,
      at: events.at,
      reason: events.reason,
      prevAt,
    })
    .from(events)
    .innerJoin(monitors, eq(monitors.id, events.monitorId))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(events.id))
    .limit(limit);
};

type EventRow = Awaited<ReturnType<typeof eventsQuery>>[number];

export const toStateEvent = ({ prevAt: prev, ...e }: EventRow): StateEvent => ({
  ...e,
  prevDurationS: prev === null ? null : Math.max(0, Math.round((e.at - prev) / 1000)),
});
