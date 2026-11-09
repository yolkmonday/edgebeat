import { format } from "date-fns";
import { Link, useNavigate } from "react-router";
import type { Monitor } from "@shared/admin-api";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TCell, THead, TRow } from "@/components/ui/table";
import { StatePill } from "@/components/shared/StatePill";
import { ago, intervalLabel, pct, periodLabel, stateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MonitorRowActions } from "@/features/monitors/MonitorRowActions";
import { monitorTarget } from "@/features/monitors/list-filter";

const lastCheck = (m: Monitor, now: number): string => {
  if (m.paused) return `Paused ${format(new Date(m.updatedAt), "MMM d")}`;
  if (m.type === "heartbeat") return m.status.lastBeatAt ? `Beat ${ago(m.status.lastBeatAt, now)}` : "No beat yet";
  return m.status.lastCheckedAt ? ago(m.status.lastCheckedAt, now) : "—";
};

export type MonitorTableProps = { monitors: Monitor[]; now: number };

/** The monitors table (screen 04). Used by the Monitors and Heartbeats pages. */
export const MonitorTable = ({ monitors, now }: MonitorTableProps) => {
  const navigate = useNavigate();
  return (
    <Table>
      <THead>
        <TRow className="hover:bg-transparent">
          <TCell head>Monitor</TCell>
          <TCell head>Type</TCell>
          <TCell head>State</TCell>
          <TCell head>Interval</TCell>
          <TCell head>Last check</TCell>
          <TCell head numeric>
            Uptime 30d
          </TCell>
          <TCell head>
            <span className="sr-only">Actions</span>
          </TCell>
        </TRow>
      </THead>
      <TBody>
        {monitors.map((m) => (
          <TRow key={m.id} onClick={() => navigate(`/monitors/${m.id}`)} className={cn("cursor-pointer", m.paused && "text-muted")}>
            <TCell>
              <div className="flex flex-col gap-0.5">
                <Link
                  to={`/monitors/${m.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className={cn("w-fit rounded-sm font-medium hover:underline", m.paused ? "text-muted" : "text-text")}
                >
                  {m.name}
                </Link>
                <span className="max-w-72 truncate font-mono text-xs text-muted">{monitorTarget(m)}</span>
              </div>
            </TCell>
            <TCell>
              <Badge>{m.type}</Badge>
            </TCell>
            <TCell>
              <StatePill state={m.status.state} label={stateLabel(m.status.state)} />
            </TCell>
            <TCell className="font-mono text-xs">{m.type === "heartbeat" ? periodLabel(m.heartbeatPeriodS ?? 0) : intervalLabel(m.intervalMin)}</TCell>
            <TCell className="font-mono text-xs text-muted">{lastCheck(m, now)}</TCell>
            <TCell numeric>{pct(m.status.uptime30)}</TCell>
            <TCell className="w-12 pr-3 pl-0" onClick={(e) => e.stopPropagation()}>
              <MonitorRowActions monitor={m} />
            </TCell>
          </TRow>
        ))}
      </TBody>
    </Table>
  );
};
