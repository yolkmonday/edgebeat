import type { SchedMonitor } from "./types";

export type { SchedMonitor } from "./types";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const fnv1a = (input: string): number => {
  const bytes = new TextEncoder().encode(input);
  const hash = bytes.reduce((h, b) => Math.imul(h ^ b, FNV_PRIME), FNV_OFFSET);
  return hash >>> 0;
};

export const slotOf = (monitorId: string, intervalMin: number): number =>
  fnv1a(monitorId) % intervalMin;

export const isDue = (m: SchedMonitor, epochMinute: number): boolean =>
  epochMinute % m.intervalMin === slotOf(m.id, m.intervalMin);

export const selectChecks = (
  monitors: SchedMonitor[],
  carry: string[],
  epochMinute: number,
  budget: number,
): { run: string[]; carry: string[] } => {
  const runnable = new Map(monitors.filter((m) => m.type !== "heartbeat").map((m) => [m.id, m]));
  const due = [...runnable.values()]
    .filter((m) => isDue(m, epochMinute))
    .map((m) => m.id)
    .sort();
  const candidates = [...new Set([...carry.filter((id) => runnable.has(id)), ...due])];
  return { run: candidates.slice(0, budget), carry: candidates.slice(budget) };
};

export const checkBudget = (plan: "free" | "paid", override?: number): number =>
  override ?? (plan === "free" ? 40 : 500);
