import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type BudgetCardProps = {
  /** Current peak checks per minute (`settings.checksPerMinute`). */
  used: number | undefined;
  budget: number | undefined;
  /** 1 when saving adds a check (at most one per minute), 0 when it is already counted or exempt. */
  adds: 0 | 1;
  exempt: "heartbeat" | "paused" | null;
};

export const BudgetCard = ({ used, budget, adds, exempt }: BudgetCardProps) => {
  const ready = used !== undefined && budget !== undefined && budget > 0;
  const after = (used ?? 0) + adds;
  const over = ready && after > budget;
  const pctOf = (n: number) => (ready ? `${Math.min(100, (n / budget) * 100)}%` : "0%");
  return (
    <Card title="Check budget">
      <div className="flex flex-col gap-3">
        <p className="flex items-baseline gap-1.5">
          <span className="text-3xl font-semibold tracking-[-0.02em] text-text">{used ?? "—"}</span>
          <span className="font-mono text-sm text-muted">/ {budget ?? "—"} per minute</span>
        </p>
        <div
          role="meter"
          aria-label="Check budget"
          aria-valuemin={0}
          aria-valuemax={budget ?? 0}
          aria-valuenow={Math.min(after, budget ?? 0)}
          className="relative flex h-2 w-full overflow-hidden rounded-pill bg-surface-3"
        >
          <div className="h-full bg-border-strong" style={{ width: pctOf(used ?? 0) }} />
          {adds ? <div className={cn("h-full", over ? "bg-down" : "bg-accent")} style={{ width: pctOf(adds) }} data-testid="new-segment" /> : null}
        </div>
        <p className={cn("text-xs", over ? "text-down-text" : "text-muted")}>
          {exempt === "heartbeat"
            ? "Heartbeats don't use the check budget."
            : exempt === "paused"
              ? "Paused monitors don't use the check budget."
              : !ready
                ? "Loading your budget…"
                : over
                  ? `This monitor would take you to ${after} of ${budget} per minute. Saving is refused unless you raise intervals or switch to the Paid plan.`
                  : adds
                    ? `This monitor adds at most 1 check per minute. ${budget - after} left after saving.`
                    : `This monitor is already counted. ${Math.max(0, budget - after)} left.`}
        </p>
      </div>
    </Card>
  );
};
