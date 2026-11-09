import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { MonitorDetail } from "@shared/admin-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { KeyValueList } from "@/components/shared/KeyValueList";
import { UptimeBars, useVisibleBarCount } from "@/components/shared/UptimeBars";
import { useTestCheck } from "@/api/use-monitors";
import { isApiError } from "@/lib/api";
import { ago, errorLabel, ms, pct } from "@/lib/format";
import { reportCheck } from "@/features/monitors/check-result";
import { RecentEvents } from "@/features/monitors/RecentEvents";
import { uptimeFromBars } from "@/features/monitors/bars";

export const CheckPanel = ({ monitor: m, now }: { monitor: MonitorDetail; now: number }) => {
  const check = useTestCheck(m.id);
  const s = m.status;
  // narrow screens draw fewer bars: title and percentage follow the bars shown
  const shown = m.bars.slice(-useVisibleBarCount());
  const run = () =>
    check.mutate(undefined, {
      onSuccess: (r) => reportCheck(m.name, r),
      onError: (e) => toast.error("Could not run the check", { description: isApiError(e) && e.code === "too_many_checks" ? "Too many checks. Wait a moment." : undefined }),
    });
  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Last check"
        actions={
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={check.isPending} onClick={run}>
            Run check now
          </Button>
        }
      >
        {s.lastCheckedAt === null ? (
          <p className="text-sm text-muted">No check has run yet. The first one runs within a minute of the next cron tick.</p>
        ) : (
          <KeyValueList
            items={[
              { label: "Checked", value: ago(s.lastCheckedAt, now), mono: true },
              { label: "Latency", value: s.latencyMs === null ? "—" : ms(s.latencyMs), mono: true },
              ...(m.type === "http" ? [{ label: "HTTP code", value: s.code ?? "—", mono: true }] : []),
              { label: "Result", value: s.error ? errorLabel(s.error) : "OK" },
            ]}
          />
        )}
      </Card>
      <Card title={`Last ${shown.length} days`} actions={<span className="font-mono text-sm text-text">{pct(uptimeFromBars(shown))}</span>}>
        <UptimeBars bars={shown} />
      </Card>
      <RecentEvents events={m.events} now={now} />
    </div>
  );
};
