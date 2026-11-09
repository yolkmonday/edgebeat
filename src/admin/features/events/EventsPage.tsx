import { useState } from "react";
import { Link } from "react-router";
import { useEvents } from "@/api/use-events";
import { useMonitors } from "@/api/use-monitors";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TCell, THead, TRow } from "@/components/ui/table";
import { eventDetail, eventTime } from "@/features/overview/event-format";
import { TransitionPills } from "@/features/overview/RecentChanges";
import { useNow } from "@/features/overview/use-now";

const ALL = "all";

export default function EventsPage() {
  const [monitorId, setMonitorId] = useState(ALL);
  const monitors = useMonitors();
  const events = useEvents(monitorId === ALL ? {} : { monitorId });
  const now = useNow(30_000);

  const options = [{ value: ALL, label: "All monitors" }, ...(monitors.data ?? []).map((m) => ({ value: m.id, label: m.name }))];
  const items = events.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="State changes" />
      <div className="w-64">
        <Select value={monitorId} onValueChange={setMonitorId} options={options} aria-label="Filter by monitor" />
      </div>
      {events.isPending ? (
        <Skeleton className="h-64" />
      ) : events.isError ? (
        <EmptyState
          illustration="error"
          title="Couldn't load state changes"
          body="Check your connection and try again."
          actions={<Button variant="secondary" onClick={() => void events.refetch()}>Try again</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          illustration="all-good"
          title="No state changes yet"
          body="When a monitor goes up, down or is paused, it shows up here."
        />
      ) : (
        <>
          <Table>
            <THead>
              <TRow>
                <TCell head>Change</TCell>
                <TCell head>Monitor</TCell>
                <TCell head>Detail</TCell>
                <TCell head className="text-right">Time</TCell>
              </TRow>
            </THead>
            <TBody>
              {items.map((e) => (
                <TRow key={e.id}>
                  <TCell>
                    <TransitionPills from={e.from} to={e.to} />
                  </TCell>
                  <TCell>
                    <Link to={`/monitors/${e.monitorId}`} className="font-medium text-text hover:underline">
                      {e.monitorName}
                    </Link>
                  </TCell>
                  <TCell className="text-muted">{eventDetail(e)}</TCell>
                  <TCell numeric className="text-xs text-muted">
                    <time dateTime={new Date(e.at).toISOString()}>{eventTime(e.at, now)}</time>
                  </TCell>
                </TRow>
              ))}
            </TBody>
          </Table>
          {events.hasNextPage ? (
            <div className="flex justify-center">
              <Button variant="secondary" loading={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
