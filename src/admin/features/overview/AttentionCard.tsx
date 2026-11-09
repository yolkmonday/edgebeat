import { Link } from "react-router";
import type { AdminState, Monitor, Overview } from "@shared/admin-api";
import { Illustration } from "@/components/shared/Illustration";
import { StatePill } from "@/components/shared/StatePill";
import { ago } from "@/lib/format";
import type { TickStatus } from "@/features/overview/tick-status";

const NEEDS_ATTENTION: ReadonlySet<AdminState> = new Set(["down", "degraded", "unknown"]);

export type AttentionCardProps = {
  overview: Overview;
  monitors: Monitor[];
  tick: TickStatus;
  now: number;
};

const Shell = ({ children }: { children: React.ReactNode }) => (
  <aside className="flex flex-col rounded-lg border border-border bg-surface shadow-[0_1px_2px_var(--shadow)] dark:shadow-[0_0_0_1px_var(--dark-ring)]">{children}</aside>
);

const Centered = ({ illustration, title, body }: { illustration: "all-good" | "stale"; title: string; body: string }) => (
  <Shell>
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Illustration name={illustration} className="w-40" />
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="max-w-xs text-xs text-muted">{body}</p>
    </div>
  </Shell>
);

export const AttentionCard = ({ overview, monitors, tick, now }: AttentionCardProps) => {
  if (tick.kind === "stale") {
    return (
      <Centered
        illustration="stale"
        title="Status unknown"
        body="No checks have run for a while, so nothing can be reported as up."
      />
    );
  }
  const flagged = monitors.filter((m) => NEEDS_ATTENTION.has(m.status.state));
  if (flagged.length === 0) {
    const recovery = overview.recentEvents.find((e) => e.to === "up" && (e.from === "down" || e.from === "degraded"));
    const sentences = [`${overview.counts.up} monitors are up.`];
    if (recovery) sentences.push(`${recovery.monitorName} recovered ${ago(recovery.at, now)}.`);
    return <Centered illustration="all-good" title="Nothing is down right now" body={sentences.join(" ")} />;
  }
  return (
    <Shell>
      <h2 className="px-6 pt-6 text-base font-semibold text-text">{flagged.length} need attention</h2>
      <ul className="mt-4 flex flex-col divide-y divide-border border-t border-border">
        {flagged.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 px-6 py-3">
            <Link to={`/monitors/${m.id}`} className="truncate text-sm font-medium text-text hover:underline">
              {m.name}
            </Link>
            <StatePill state={m.status.state} />
          </li>
        ))}
      </ul>
    </Shell>
  );
};
