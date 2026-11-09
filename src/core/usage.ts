export type UsageInput = {
  minutesElapsed: number;
  ticksToday: number;
  activeChecked: number;
  eventsToday: number;
  heartbeatPeriodsS: number[];
};

/** Estimated D1 rows written today by Edgebeat itself, and the projection to the end of the UTC day. */
export const estimateWritesToday = (i: UsageInput): { value: number; projected: number } => {
  const beats = i.heartbeatPeriodsS.reduce(
    (sum, periodS) => sum + Math.min(i.minutesElapsed * 2, (i.minutesElapsed * 60) / periodS),
    0,
  );
  const value = Math.round(
    i.ticksToday * 3 +
      Math.floor(i.ticksToday / 15) * (i.activeChecked + 1) +
      i.eventsToday * 2 +
      beats +
      Math.floor(i.minutesElapsed / 60) * 60,
  );
  return { value, projected: Math.round((value * 1440) / Math.max(i.minutesElapsed, 15)) };
};

/**
 * Ticks run today, assuming the cron fired every minute from 00:00 UTC up to the last tick.
 * Derived instead of counted: a `count(*)` over today's ticks reads up to 1440 rows per overview poll.
 */
export const ticksTodayEstimate = (dayStart: number, lastTickAt: number | null): number =>
  lastTickAt === null || lastTickAt < dayStart ? 0 : Math.floor((lastTickAt - dayStart) / 60_000) + 1;
