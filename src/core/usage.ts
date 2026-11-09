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
