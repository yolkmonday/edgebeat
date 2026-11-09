import type { CheckResult } from "@/core/types";
import { runHttpCheck, type HttpMonitor, type TakeSubrequest } from "@/checks/http";
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
  /** Per-tick cap on outbound subrequests: initial fetches, retries, every redirect hop, TCP connects. */
  subrequestBudget: number;
};

/** Null: the check could not get a subrequest and was not run. */
const runOne = (m: RunnableMonitor, timeoutMs: number, take: TakeSubrequest): Promise<CheckResult | null> => {
  if (m.type === "http") return runHttpCheck(m, timeoutMs, take);
  return take() ? runTcpCheck(m, timeoutMs) : Promise.resolve(null);
};

export const runChecks = async (
  ms: RunnableMonitor[],
  o: RunOptions,
): Promise<{ results: CheckResult[]; notStarted: string[] }> => {
  const slots: (CheckResult | undefined)[] = new Array(ms.length).fill(undefined);
  let next = 0;
  let budget = o.retryBudget;
  let subrequests = o.subrequestBudget;
  const take: TakeSubrequest = () => {
    if (subrequests <= 0) return false;
    subrequests--;
    return true;
  };

  const timeoutFor = (m: RunnableMonitor): number =>
    Math.max(1, Math.min(m.timeoutMs ?? DEFAULT_TCP_TIMEOUT_MS, o.deadlineAt - o.now()));

  const worker = async (): Promise<void> => {
    while (next < ms.length && o.now() < o.deadlineAt) {
      const i = next++;
      const m = ms[i]!;
      const first = await runOne(m, timeoutFor(m), take);
      if (!first) continue; // not run: carried by the caller
      let result = first;
      if (!result.ok && budget > 0 && o.now() < o.deadlineAt) {
        budget--;
        // a retry that cannot get a subrequest keeps the first result
        result = (await runOne(m, timeoutFor(m), take)) ?? first;
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
