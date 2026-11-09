import { checkBudget, isDue } from "./schedule";
import type { MonitorType } from "./types";

export type BudgetMonitor = { id: string; type: MonitorType; intervalMin: number; paused: boolean };

/** Max number of checks due in any single minute of an hour (all intervals divide 60). */
export const peakChecksPerMinute = (ms: BudgetMonitor[]): number => {
  const active = ms.filter((m) => m.type !== "heartbeat" && !m.paused);
  return Array.from({ length: 60 }, (_, minute) => active.filter((m) => isDue(m, minute)).length).reduce(
    (a, b) => Math.max(a, b),
    0,
  );
};

export const effectiveBudget = (plan: "free" | "paid", override: number | null): number =>
  checkBudget(plan, override ?? undefined);

export type BudgetVerdict = { ok: true } | { ok: false; used: number; after: number; budget: number };

/** Refuses only a change that exceeds the budget AND raises the peak; edits that do not raise it always pass. */
export const budgetVerdict = (before: BudgetMonitor[], after: BudgetMonitor[], budget: number): BudgetVerdict => {
  const used = peakChecksPerMinute(before);
  const next = peakChecksPerMinute(after);
  return next > budget && next > used ? { ok: false, used, after: next, budget } : { ok: true };
};
