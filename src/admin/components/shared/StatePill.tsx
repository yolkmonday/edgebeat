import { Pause } from "lucide-react";
import type { AdminState } from "@shared/admin-api";
import { cn } from "@/lib/utils";

export type PillState = AdminState | "partial";

const STYLES: Record<PillState, { label: string; box: string; dot: string }> = {
  up: { label: "Operational", box: "border-up-border bg-up-bg text-up-text", dot: "bg-up" },
  degraded: { label: "Degraded", box: "border-degraded-border bg-degraded-bg text-degraded-text", dot: "bg-degraded" },
  partial: { label: "Partial outage", box: "border-partial-border bg-partial-bg text-partial-text", dot: "bg-partial" },
  down: { label: "Down", box: "border-down-border bg-down-bg text-down-text", dot: "bg-down" },
  maintenance: { label: "Maintenance", box: "border-maint-border bg-maint-bg text-maint-text", dot: "bg-maint" },
  paused: { label: "Paused", box: "border-unknown-border bg-unknown-bg text-paused", dot: "bg-paused" },
  pending: { label: "Pending", box: "border-unknown-border bg-unknown-bg text-muted", dot: "border border-pending bg-transparent" },
  unknown: { label: "Unknown", box: "border-unknown-border bg-unknown-bg text-muted", dot: "bg-unknown" },
};

export type StatePillProps = { state: PillState; label?: string; className?: string };

export const StatePill = ({ state, label, className }: StatePillProps) => {
  const s = STYLES[state];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-pill border px-2.5 text-xs font-medium", s.box, className)}>
      {state === "paused" ? <Pause size={10} aria-hidden /> : <span className={cn("size-1.5 rounded-pill", s.dot)} aria-hidden />}
      {label ?? s.label}
    </span>
  );
};
