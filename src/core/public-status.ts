import { utcDay, type Bar } from "./stats";
import type { CurrentEntry } from "./types";

export type PublicState = "up" | "degraded" | "down" | "maintenance" | "paused" | "pending" | "unknown";
export type Overall = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance" | "unknown";
export type SnapshotCurrent = Record<string, CurrentEntry>;

export type PublicMonitor = {
  slug: string;
  name: string;
  state: PublicState;
  lastCheckedAt: number | null;
  uptime90: number | null;
  bars: Bar[];
};

export type PublicStatus = {
  siteName: string;
  generatedAt: number;
  lastTickAt: number | null;
  stale: boolean;
  overall: Overall;
  groups: { slug: string; name: string; monitors: PublicMonitor[] }[];
};

export type PublicStatusInput = {
  now: number;
  siteName: string;
  lastTickAt: number | null;
  groups: { slug: string; name: string; sort: number }[];
  monitors: {
    id: string;
    slug: string;
    name: string;
    groupSlug: string | null;
    intervalMin: number;
    isPublic: boolean;
    paused: boolean;
    sort: number;
  }[];
  current: SnapshotCurrent;
  bars: Record<string, Bar[]>;
};

export const TICK_STALE_MS = 180_000;
export const BAR_DAYS = 90;
const DAY_MS = 86_400_000;

/** Exactly `days` bars oldest -> newest ending at utcDay(now); missing days are grey, outside bars dropped. */
export const alignBars = (stored: Bar[], now: number, days = BAR_DAYS): Bar[] => {
  const byDay = new Map(stored.map((b) => [b.day, b]));
  const todayMs = Date.parse(`${utcDay(now)}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const day = utcDay(todayMs - (days - 1 - i) * DAY_MS);
    return byDay.get(day) ?? { day, uptime: null, downtimeS: 0, observedS: 0 };
  });
};

const uptime90Of = (bars: Bar[]): number | null => {
  const seen = bars.filter((b) => b.uptime !== null);
  const observed = seen.reduce((a, b) => a + b.observedS, 0);
  if (observed === 0) return null;
  const down = seen.reduce((a, b) => a + b.downtimeS, 0);
  return Math.round(Math.max(0, 1 - down / observed) * 10_000) / 10_000;
};

const byOrder = <T extends { sort: number; name: string }>(a: T, b: T): number =>
  a.sort - b.sort || a.name.localeCompare(b.name);

const stateOf = (
  m: PublicStatusInput["monitors"][number],
  entry: CurrentEntry | undefined,
  now: number,
  stale: boolean,
): PublicState => {
  if (m.paused) return "paused";
  if (stale) return "unknown";
  if (!entry || entry.lastCheckedAt === null) return "pending";
  if (now - entry.lastCheckedAt > 3 * m.intervalMin * 60_000) return "unknown";
  // a stored "paused" for a monitor no longer flagged paused is not a live signal
  return entry.state === "paused" ? "unknown" : entry.state;
};

/** R18 order: a grey (unknown) row never sits under a green banner. */
const overallOf = (stale: boolean, states: PublicState[]): Overall => {
  if (stale) return "unknown";
  const live = states.filter((s) => s !== "paused");
  const downs = live.filter((s) => s === "down").length;
  if (downs > 0) return downs === live.length ? "major_outage" : "partial_outage";
  if (live.includes("unknown")) return "unknown";
  if (live.includes("degraded")) return "degraded";
  if (live.includes("maintenance")) return "maintenance";
  if (live.every((s) => s === "pending")) return "unknown";
  return "operational";
};

export const buildPublicStatus = (input: PublicStatusInput): PublicStatus => {
  const { now, lastTickAt } = input;
  const stale = lastTickAt === null || now - lastTickAt > TICK_STALE_MS;
  const pub = input.monitors.filter((m) => m.isPublic);

  const states: PublicState[] = [];
  const toPublic = (m: (typeof pub)[number]): PublicMonitor => {
    const entry = input.current[m.id];
    const state = stateOf(m, entry, now, stale);
    states.push(state);
    const bars = alignBars(input.bars[m.id] ?? [], now);
    return {
      slug: m.slug,
      name: m.name,
      state,
      lastCheckedAt: entry?.lastCheckedAt ?? null,
      uptime90: uptime90Of(bars),
      bars,
    };
  };

  const known = new Set(input.groups.map((g) => g.slug));
  const inGroup = (slug: string | null) =>
    pub.filter((m) => (slug === null ? m.groupSlug === null || !known.has(m.groupSlug) : m.groupSlug === slug));

  const groups = [...input.groups]
    .sort(byOrder)
    .map((g) => ({ slug: g.slug, name: g.name, monitors: inGroup(g.slug).sort(byOrder).map(toPublic) }));
  const other = inGroup(null).sort(byOrder).map(toPublic);
  const out = [...groups, { slug: "other", name: "Other", monitors: other }].filter((g) => g.monitors.length > 0);

  return { siteName: input.siteName, generatedAt: now, lastTickAt, stale, overall: overallOf(stale, states), groups: out };
};

/**
 * Client-side ageing of a status the page already holds: `now` is the page's estimate of
 * server time (generatedAt + time since the response arrived). Once the last tick is older
 * than TICK_STALE_MS the status is shown stale and unknown, even if refreshes keep failing.
 */
export const withClientStaleness = (status: PublicStatus, now: number): PublicStatus => {
  const { lastTickAt } = status;
  if (lastTickAt !== null && now - lastTickAt <= TICK_STALE_MS) return status;
  return {
    ...status,
    stale: true,
    overall: "unknown",
    groups: status.groups.map((g) => ({
      ...g,
      monitors: g.monitors.map((m) => (m.state === "paused" ? m : { ...m, state: "unknown" })),
    })),
  };
};
