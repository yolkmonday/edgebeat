import type { CheckResult } from "@/core/types";
import { runHttpCheck, type HttpMonitor } from "@/checks/http";
import { runTcpCheck, type TcpMonitor } from "@/checks/tcp";

const DEFAULT_TCP_TIMEOUT_MS = 10_000;

export type RunnableMonitor =
  | ({ type: "http" } & HttpMonitor)
  | ({ type: "tcp"; timeoutMs?: number } & TcpMonitor);

type RunOptions = {
  concurrency: number;
  retryBudget: number;
  deadlineAt: number;
  now: () => number;
};

const runOne = (m: RunnableMonitor, timeoutMs: number): Promise<CheckResult> =>
  m.type === "http" ? runHttpCheck(m, timeoutMs) : runTcpCheck(m, timeoutMs);

export const runChecks = async (
  ms: RunnableMonitor[],
  o: RunOptions,
): Promise<{ results: CheckResult[]; notStarted: string[] }> => {
  const slots: (CheckResult | undefined)[] = new Array(ms.length).fill(undefined);
  let next = 0;
  let budget = o.retryBudget;

  const timeoutFor = (m: RunnableMonitor): number =>
    Math.max(1, Math.min(m.timeoutMs ?? DEFAULT_TCP_TIMEOUT_MS, o.deadlineAt - o.now()));

  const worker = async (): Promise<void> => {
    while (next < ms.length && o.now() < o.deadlineAt) {
      const i = next++;
      const m = ms[i]!;
      let result = await runOne(m, timeoutFor(m));
      if (!result.ok && budget > 0 && o.now() < o.deadlineAt) {
        budget--;
        result = await runOne(m, timeoutFor(m));
      }
      slots[i] = result;
    }
  };

  const n = Math.max(1, Math.min(o.concurrency, ms.length));
  await Promise.all(Array.from({ length: n }, worker));

  const results: CheckResult[] = [];
  const notStarted: string[] = [];
  slots.forEach((r, i) => {
    if (r) results.push(r);
    else notStarted.push(ms[i]!.id);
  });
  return { results, notStarted };
};
