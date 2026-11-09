import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import type { MonitorState } from "../../../core/types";
import type { StateEvent } from "@shared/admin-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatePill } from "@/components/shared/StatePill";
import { stateLabel } from "@/lib/format";
import { eventDetail, eventTime } from "@/features/overview/event-format";

const Pill = ({ state }: { state: MonitorState }) => <StatePill state={state} label={stateLabel(state)} />;

export const TransitionPills = ({ from, to }: { from: MonitorState; to: MonitorState }) => (
  <span className="inline-flex items-center gap-2">
    <Pill state={from} />
    <ArrowRight size={14} className="text-muted" aria-label="to" />
    <Pill state={to} />
  </span>
);

export type RecentChangesProps = { events: StateEvent[]; now: number };

export const RecentChanges = ({ events, now }: RecentChangesProps) => (
  <Card
    className="[&>div]:p-0"
    title="Recent state changes"
    description="Last 7 days"
    actions={
      <Button asChild variant="ghost" size="sm">
        <Link to="/events">View all</Link>
      </Button>
    }
  >
    {events.length === 0 ? (
      <p className="mt-6 border-t border-border px-6 py-8 text-center text-sm text-muted">No state changes in the last 7 days.</p>
    ) : (
      <ul className="mt-6 divide-y divide-border border-t border-border">
        {events.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
            <div className="w-52 shrink-0">
              <TransitionPills from={e.from} to={e.to} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <Link to={`/monitors/${e.monitorId}`} className="truncate text-sm font-medium text-text hover:underline">
                {e.monitorName}
              </Link>
              <span className="truncate text-xs text-muted">{eventDetail(e)}</span>
            </div>
            <time dateTime={new Date(e.at).toISOString()} className="shrink-0 font-mono text-xs text-muted">
              {eventTime(e.at, now)}
            </time>
          </li>
        ))}
      </ul>
    )}
  </Card>
);
