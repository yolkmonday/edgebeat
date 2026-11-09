import type { AdminState, Monitor } from "@shared/admin-api";
import { periodLabel } from "@/lib/format";

export type StateFilter = "all" | AdminState;

export const STATE_TABS: { value: StateFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
  { value: "degraded", label: "Degraded" },
  { value: "paused", label: "Paused" },
  { value: "pending", label: "Pending" },
  { value: "unknown", label: "Unknown" },
];

export const PAGE_SIZE = 20;

/** Mono subtitle under the monitor name. */
export const monitorTarget = (m: Monitor): string => {
  if (m.type === "http") return m.url ?? "";
  if (m.type === "tcp") return `${m.host ?? ""}:${m.port ?? ""}`;
  return `Every ${periodLabel(m.heartbeatPeriodS ?? 0)}, ${periodLabel(m.heartbeatGraceS ?? 0)} grace`;
};

export const countByState = (ms: Monitor[]): Record<StateFilter, number> => {
  const counts: Record<StateFilter, number> = { all: ms.length, up: 0, degraded: 0, down: 0, maintenance: 0, paused: 0, pending: 0, unknown: 0 };
  for (const m of ms) counts[m.status.state] += 1;
  return counts;
};

export const filterMonitors = (ms: Monitor[], f: { state: StateFilter; q: string }): Monitor[] => {
  const q = f.q.trim().toLowerCase();
  return ms.filter((m) => {
    if (f.state !== "all" && m.status.state !== f.state) return false;
    if (!q) return true;
    return [m.name, m.slug, m.url, m.host].some((s) => s?.toLowerCase().includes(q));
  });
};

export type Page<T> = { items: T[]; page: number; pageCount: number; total: number };

/** 1-based page, clamped into range. */
export const paginate = <T>(items: T[], page: number, size = PAGE_SIZE): Page<T> => {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return { items: items.slice((current - 1) * size, current * size), page: current, pageCount, total: items.length };
};
