import { Plus, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { Monitor } from "@shared/admin-api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { PageHeader } from "@/components/shared/PageHeader";
import { useMonitors } from "@/api/use-monitors";
import { MonitorTable } from "@/features/monitors/MonitorTable";
import { MonitorsEmpty } from "@/features/monitors/MonitorsEmpty";
import { STATE_TABS, countByState, filterMonitors, paginate, type StateFilter } from "@/features/monitors/list-filter";

export type MonitorListProps = { kind: "monitors" | "heartbeats" };

const COPY = {
  monitors: { title: "Monitors", add: "Add monitor", addTo: "/monitors/new" },
  heartbeats: { title: "Heartbeats", add: "Add heartbeat", addTo: "/monitors/new?type=heartbeat" },
} as const;

const isStateFilter = (v: string | null): v is StateFilter => STATE_TABS.some((t) => t.value === v);

/** Header, filter tabs, search, table and pager shared by the Monitors and Heartbeats pages. */
export const MonitorList = ({ kind }: MonitorListProps) => {
  const copy = COPY[kind];
  const [params, setParams] = useSearchParams();
  const { data, isPending, isError, refetch, dataUpdatedAt } = useMonitors();

  const rawState = params.get("state");
  const state: StateFilter = isStateFilter(rawState) ? rawState : "all";
  const q = params.get("q") ?? "";
  const page = Number(params.get("page")) || 1;

  const update = (next: { state?: StateFilter; q?: string; page?: number }) => {
    const merged = { state, q, page, ...next };
    const out = new URLSearchParams();
    if (merged.state !== "all") out.set("state", merged.state);
    if (merged.q) out.set("q", merged.q);
    if (merged.page > 1) out.set("page", String(merged.page));
    setParams(out, { replace: true });
  };

  const scope: Monitor[] = (data ?? []).filter((m) => kind === "monitors" || m.type === "heartbeat");
  const filtered = filterMonitors(scope, { state, q });
  const counts = countByState(scope);
  const paged = paginate(filtered, page);

  const header = (
    <PageHeader
      title={copy.title}
      actions={
        scope.length > 0 || isPending ? (
          <Button asChild>
            <Link to={copy.addTo}>
              <Plus size={16} aria-hidden />
              {copy.add}
            </Link>
          </Button>
        ) : null
      }
    />
  );

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState illustration="error" title="Couldn't load monitors" body="The admin API didn't answer. Check your connection and try again." actions={<Button variant="secondary" onClick={() => refetch()}>Try again</Button>} />
      </div>
    );
  }

  if (scope.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {kind === "monitors" ? (
          <MonitorsEmpty />
        ) : (
          <EmptyState
            illustration="heartbeat"
            title="No heartbeats yet"
            body="A heartbeat waits for your cron job or backup script to ping a URL. If the ping stops, you find out."
            actions={
              <Button asChild>
                <Link to={copy.addTo}>
                  <Plus size={16} aria-hidden />
                  {copy.add}
                </Link>
              </Button>
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-full overflow-x-auto">
          <Tabs
            aria-label="Filter by state"
            value={state}
            onValueChange={(v) => update({ state: v as StateFilter, page: 1 })}
            items={STATE_TABS.map((t) => ({ ...t, count: counts[t.value] }))}
          />
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input className="pl-9" type="search" aria-label="Search monitors" placeholder="Search name or URL" value={q} onChange={(e) => update({ q: e.target.value, page: 1 })} />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {paged.total === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted">No monitors match</p>
        ) : (
          <div className="[&>div]:rounded-none [&>div]:border-0">
            <MonitorTable monitors={paged.items} now={dataUpdatedAt || Date.now()} />
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3">
          <p className="font-mono text-xs text-muted">
            Showing {paged.items.length} of {paged.total}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={paged.page <= 1} onClick={() => update({ page: paged.page - 1 })}>
              Previous
            </Button>
            <Button variant="secondary" size="sm" disabled={paged.page >= paged.pageCount} onClick={() => update({ page: paged.page + 1 })}>
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
