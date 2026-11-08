import type { CheckResult, MonitorState } from "./types";

export type PrevState = { state: MonitorState; consecutiveFailures: number };
export type EvalOpts = {
  confirmations: number;
  degradedThresholdMs: number | null;
  inMaintenance: boolean;
  paused: boolean;
};
export type EvalResult = {
  next: PrevState;
  changed: boolean;
  transition: { from: MonitorState; to: MonitorState } | null;
};

const nextState = (prev: PrevState, r: CheckResult, o: EvalOpts): PrevState => {
  if (o.paused) return { state: "paused", consecutiveFailures: 0 };
  if (o.inMaintenance) return { state: "maintenance", consecutiveFailures: 0 };
  if (r.ok) {
    const slow = o.degradedThresholdMs !== null && r.latencyMs !== null && r.latencyMs > o.degradedThresholdMs;
    return { state: slow ? "degraded" : "up", consecutiveFailures: 0 };
  }
  const failures = prev.consecutiveFailures + 1;
  if (failures >= o.confirmations) return { state: "down", consecutiveFailures: failures };
  const leaving = prev.state === "paused" || prev.state === "maintenance";
  return { state: leaving ? "pending" : prev.state, consecutiveFailures: failures };
};

export const evaluate = (prev: PrevState, r: CheckResult, o: EvalOpts): EvalResult => {
  const next = nextState(prev, r, o);
  const stateChanged = next.state !== prev.state;
  return {
    next,
    changed: stateChanged || next.consecutiveFailures !== prev.consecutiveFailures,
    transition: stateChanged ? { from: prev.state, to: next.state } : null,
  };
};
