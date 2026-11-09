import type { StateEvent } from "@shared/admin-api";
import { Card } from "@/components/ui/card";
import { StatePill } from "@/components/shared/StatePill";
import { ago, duration, errorLabel, stateLabel } from "@/lib/format";
import type { ErrorClass } from "../../../core/types";

const REASONS: Record<string, string> = { ok: "Check passed", paused: "Paused", unpaused: "Resumed" };
const reasonLabel = (reason: string): string => REASONS[reason] ?? (reason in { timeout: 1, dns: 1, connect: 1, tls: 1, status: 1, keyword: 1, heartbeat_late: 1, heartbeat_fail: 1, other: 1 } ? errorLabel(reason as ErrorClass) : reason);

export type RecentEventsProps = { events: StateEvent[]; now: number };

export const RecentEvents = ({ events, now }: RecentEventsProps) => (
  <Card title="Recent events" description="The last state changes for this monitor.">
    {events.length === 0 ? (
      <p className="text-sm text-muted">No state changes yet.</p>
    ) : (
      <ul className="flex flex-col divide-y divide-border">
        {events.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <StatePill state={e.from} label={stateLabel(e.from)} />
                <span aria-hidden className="text-muted">
                  →
                </span>
                <span className="sr-only">to</span>
                <StatePill state={e.to} label={stateLabel(e.to)} />
              </div>
              <p className="text-xs text-muted">
                {reasonLabel(e.reason)}
                {e.prevDurationS != null ? ` · was ${stateLabel(e.from).toLowerCase()} for ${duration(e.prevDurationS)}` : ""}
              </p>
            </div>
            <time dateTime={new Date(e.at).toISOString()} className="font-mono text-xs text-muted">
              {ago(e.at, now)}
            </time>
          </li>
        ))}
      </ul>
    )}
  </Card>
);
