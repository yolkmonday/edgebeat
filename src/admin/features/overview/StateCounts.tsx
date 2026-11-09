import { Link } from "react-router";
import { Pause } from "lucide-react";
import type { AdminState, Overview } from "@shared/admin-api";
import { Card } from "@/components/ui/card";
import { stateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const ORDER: AdminState[] = ["up", "degraded", "down", "maintenance", "paused", "pending", "unknown"];

const DOT: Record<AdminState, string> = {
  up: "bg-up",
  degraded: "bg-degraded",
  down: "bg-down",
  maintenance: "bg-maint",
  paused: "bg-paused",
  pending: "bg-pending",
  unknown: "bg-unknown",
};

export type StateCountsProps = { counts: Overview["counts"]; totals: Overview["totals"] };

export const StateCounts = ({ counts, totals }: StateCountsProps) => (
  <Card
    title="Monitors by state"
    actions={
      <span className="font-mono text-xs text-muted">
        {totals.all} total · {totals.checks} checks, {totals.heartbeats} heartbeats
      </span>
    }
  >
    <ul className="grid grid-cols-2 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
      {ORDER.map((state) => (
        <li key={state} className="border-border lg:border-l lg:pl-4 lg:first:border-l-0 lg:first:pl-0">
          <Link
            to={`/monitors?state=${state}`}
            className="group flex flex-col gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex items-center gap-1.5 text-xs text-muted group-hover:text-text">
              {state === "paused" ? <Pause size={10} aria-hidden /> : <span className={cn("size-1.5 rounded-pill", DOT[state])} aria-hidden />}
              {stateLabel(state)}
            </span>
            <span className="font-mono text-3xl tabular-nums text-text">{counts[state]}</span>
          </Link>
        </li>
      ))}
    </ul>
  </Card>
);
