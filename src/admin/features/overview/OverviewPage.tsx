import { Link } from "react-router";
import { Plus } from "lucide-react";
import { useMonitors } from "@/api/use-monitors";
import { useOverview } from "@/api/use-overview";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionCard } from "@/features/overview/AttentionCard";
import { RecentChanges } from "@/features/overview/RecentChanges";
import { StateCounts } from "@/features/overview/StateCounts";
import { TickCard } from "@/features/overview/TickCard";
import { serverNow, tickStatus } from "@/features/overview/tick-status";
import { UsageCards } from "@/features/overview/UsageCards";
import { useNow } from "@/features/overview/use-now";

const AddMonitorButton = () => (
  <Button asChild>
    <Link to="/monitors/new">
      <Plus size={16} aria-hidden />
      Add monitor
    </Link>
  </Button>
);

export default function OverviewPage() {
  const overview = useOverview();
  const monitors = useMonitors();
  const now = useNow(1000);

  const header = <PageHeader title="Overview" actions={<AddMonitorButton />} />;

  if (overview.isError && !overview.data) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          illustration="error"
          title="Couldn't load the overview"
          body="Check your connection and try again."
          actions={<Button variant="secondary" onClick={() => void overview.refetch()}>Try again</Button>}
        />
      </div>
    );
  }
  if (!overview.data) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Skeleton className="h-24" />
        <Skeleton className="h-36" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const data = overview.data;
  const fetchedAt = overview.dataUpdatedAt;
  const tick = tickStatus(data, now, fetchedAt);
  const serverTime = serverNow(data, now, fetchedAt);

  return (
    <div className="flex flex-col gap-6">
      {header}
      <TickCard status={tick} />
      <StateCounts counts={data.counts} totals={data.totals} />
      <UsageCards usage={data.usage} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <RecentChanges events={data.recentEvents} now={serverTime} />
        <AttentionCard overview={data} monitors={monitors.data ?? []} tick={tick} now={serverTime} />
      </div>
    </div>
  );
}
