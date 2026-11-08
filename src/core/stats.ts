import type { CheckResult, MonitorState } from "./types";

// Upper bounds (ms) of the latency buckets; one extra overflow bucket follows.
export const LATENCY_BUCKETS_MS = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, 30000];

const DAY_MS = 86_400_000;

export type DayStats = {
  checks: number;
  failures: number;
  downtimeS: number;
  observedS: number;
  hist: number[];
};

export type Bar = { day: string; uptime: number | null; downtimeS: number; observedS: number };

export const emptyDay = (): DayStats => ({
  checks: 0,
  failures: 0,
  downtimeS: 0,
  observedS: 0,
  hist: new Array(LATENCY_BUCKETS_MS.length + 1).fill(0),
});

const bucketOf = (latencyMs: number): number => {
  const i = LATENCY_BUCKETS_MS.findIndex((bound) => latencyMs <= bound);
  return i === -1 ? LATENCY_BUCKETS_MS.length : i;
};

export const addTickResults = (day: DayStats, results: CheckResult[], intervalMin: number): DayStats => {
  const hist = [...day.hist];
  let failures = day.failures;
  for (const r of results) {
    if (!r.ok) failures += 1;
    if (r.ok && r.latencyMs !== null) hist[bucketOf(r.latencyMs)] += 1;
  }
  return {
    ...day,
    checks: day.checks + results.length,
    failures,
    observedS: day.observedS + results.length * intervalMin * 60,
    hist,
  };
};

/**
 * Upper bound (ms) of the bucket holding the p-th percentile sample (p in 0..100).
 * Samples in the overflow bucket report the last finite bound (30000). Null when empty.
 */
export const percentile = (hist: number[], p: number): number | null => {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * total));
  let cum = 0;
  for (let i = 0; i < hist.length; i++) {
    cum += hist[i]!;
    if (cum >= rank) return LATENCY_BUCKETS_MS[Math.min(i, LATENCY_BUCKETS_MS.length - 1)]!;
  }
  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]!;
};

type Interval = [number, number];

const mergeIntervals = (xs: Interval[]): Interval[] => {
  const sorted = xs.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
};

/**
 * Seconds spent in `down` within [from, to), minus overlap with maintenance windows
 * (overlapping windows are merged first). Events may be unsorted. Result is rounded
 * to the nearest whole second.
 */
export const downtimeSeconds = (
  events: { toState: MonitorState; at: number }[],
  stateAtStart: MonitorState,
  from: number,
  to: number,
  maintenance: [number, number][] = [],
): number => {
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const downs: Interval[] = [];
  let downSince: number | null = stateAtStart === "down" ? from : null;
  for (const ev of sorted) {
    if (ev.toState === "down") {
      if (downSince === null) downSince = ev.at;
    } else if (downSince !== null) {
      downs.push([downSince, ev.at]);
      downSince = null;
    }
  }
  if (downSince !== null) downs.push([downSince, to]);

  const windows = mergeIntervals(maintenance.map(([s, e]) => [s, e] as Interval));
  let ms = 0;
  for (const [s, e] of downs) {
    const cs = Math.max(s, from);
    const ce = Math.min(e, to);
    if (ce <= cs) continue;
    let len = ce - cs;
    for (const [ws, we] of windows) {
      len -= Math.max(0, Math.min(ce, we) - Math.max(cs, ws));
    }
    ms += len;
  }
  return Math.round(ms / 1000);
};

export const uptimeOf = (d: DayStats): number | null => {
  if (d.observedS === 0) return null;
  const u = Math.max(0, 1 - d.downtimeS / d.observedS);
  return Math.round(u * 10_000) / 10_000;
};

export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** Bars oldest -> newest; keeps at most `days` bars (including today). */
export const rollBars = (bars: Bar[], today: string, todayStats: DayStats, days = 90): Bar[] => {
  const todayBar: Bar = {
    day: today,
    uptime: uptimeOf(todayStats),
    downtimeS: todayStats.downtimeS,
    observedS: todayStats.observedS,
  };
  const past = bars.filter((b) => b.day < today);
  const last = past[past.length - 1];
  const filled: Bar[] = [...past];
  if (last) {
    for (let t = dayMs(last.day) + DAY_MS; t < dayMs(today); t += DAY_MS) {
      filled.push({ day: utcDay(t), uptime: null, downtimeS: 0, observedS: 0 });
    }
  }
  return [...filled, todayBar].slice(-days);
};
