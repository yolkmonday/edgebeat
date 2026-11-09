import { alignBars, monitorStateAt, TICK_STALE_MS, uptimeOfBars, type SnapshotCurrent } from "@/core/public-status";
import type { Bar } from "@/core/stats";
import type { heartbeats } from "@/db/schema";
import type { MonitorStatus } from "@/shared/admin-api";
import { isRecord, parseJson } from "@/tick/batch";
import type { Row } from "@/api/admin/monitor-columns";

export type SnapshotView = {
  lastTickAt: number | null;
  stale: boolean;
  current: SnapshotCurrent;
  bars: Record<string, Bar[]>;
};

type SnapshotRow = { lastTickAt: number; current: string; bars?: string } | undefined;

/** lastTickAt 0 (a freshly created snapshot row) counts as "never ticked". */
export const readSnapshot = (row: SnapshotRow, now: number): SnapshotView => {
  const lastTickAt = row && row.lastTickAt > 0 ? row.lastTickAt : null;
  return {
    lastTickAt,
    stale: lastTickAt === null || now - lastTickAt > TICK_STALE_MS,
    current: parseJson<SnapshotCurrent>(row?.current ?? "{}", {}, isRecord),
    bars: parseJson<Record<string, Bar[]>>(row?.bars ?? "{}", {}, isRecord),
  };
};

export const statusOf = (
  row: Row,
  snap: SnapshotView,
  beat: typeof heartbeats.$inferSelect | undefined,
  now: number,
): MonitorStatus => {
  const entry = snap.current[row.id];
  return {
    state: monitorStateAt({ intervalMin: row.intervalMin, paused: row.paused === 1 }, entry, now, snap.stale),
    lastCheckedAt: entry?.lastCheckedAt ?? null,
    latencyMs: entry?.latencyMs ?? null,
    code: entry?.code ?? null,
    error: entry?.error ?? null,
    lastBeatAt: row.type === "heartbeat" ? (beat?.lastBeatAt ?? null) : null,
    uptime30: uptimeOfBars(alignBars(snap.bars[row.id] ?? [], now, 30)),
  };
};
