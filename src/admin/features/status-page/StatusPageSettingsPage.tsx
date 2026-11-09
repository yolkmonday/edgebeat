import { useState } from "react";
import { Link } from "react-router";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { Group, Monitor } from "@shared/admin-api";
import { useGroups, useUpdateGroup } from "@/api/use-groups";
import { useMonitors } from "@/api/use-monitors";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatePill } from "@/components/shared/StatePill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { OrderButtons } from "@/features/groups/OrderButtons";
import { reorderPatches } from "@/features/groups/reorder";
import { useMonitorPatch } from "@/features/status-page/use-monitor-patch";

const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;

type Section = { id: string; name: string; group: Group | null; monitors: Monitor[] };

const MonitorRow = ({
  monitor,
  index,
  count,
  busy,
  onMove,
  onTogglePublic,
}: {
  monitor: Monitor;
  index: number;
  count: number;
  busy: boolean;
  onMove: (dir: -1 | 1) => void;
  onTogglePublic: (isPublic: boolean) => void;
}) => (
  <li className="flex flex-wrap items-center gap-3 py-2.5 pl-4">
    <Link to={`/monitors/${monitor.id}`} className="min-w-0 flex-1 truncate text-sm text-text hover:underline">
      {monitor.name}
    </Link>
    <StatePill state={monitor.status.state} />
    <label className="flex items-center gap-2 text-xs text-muted">
      Public
      <Switch checked={monitor.isPublic} disabled={busy} onCheckedChange={onTogglePublic} aria-label={`Show ${monitor.name} on the status page`} />
    </label>
    <OrderButtons name={monitor.name} index={index} count={count} disabled={busy} onMove={onMove} />
  </li>
);

export default function StatusPageSettingsPage() {
  const groups = useGroups();
  const monitors = useMonitors();
  const updateGroup = useUpdateGroup();
  const patchMonitor = useMonitorPatch();
  const [busy, setBusy] = useState(false);

  const origin = `${window.location.origin}/`;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch {
      toast.error("Couldn't save the change");
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <PageHeader
      title="Status page"
      actions={
        <Button asChild variant="secondary">
          <a href="/" target="_blank" rel="noreferrer">
            <ExternalLink size={16} aria-hidden />
            View status page
          </a>
        </Button>
      }
    />
  );

  if (groups.isPending || monitors.isPending) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (groups.isError || monitors.isError) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          illustration="error"
          title="Couldn't load the status page settings"
          body="Check your connection and try again."
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                void groups.refetch();
                void monitors.refetch();
              }}
            >
              Try again
            </Button>
          }
        />
      </div>
    );
  }

  const sortedGroups = [...groups.data].sort(bySort);
  const monitorsIn = (groupId: string | null) => monitors.data.filter((m) => m.groupId === groupId).sort(bySort);
  const sections: Section[] = [
    ...sortedGroups.map((g) => ({ id: g.id, name: g.name, group: g, monitors: monitorsIn(g.id) })),
    { id: "other", name: "Other", group: null, monitors: monitorsIn(null) },
  ].filter((s) => s.group !== null || s.monitors.length > 0);

  const moveGroup = (index: number, dir: -1 | 1) =>
    run(() => Promise.all(reorderPatches(sortedGroups, index, dir).map(({ id, sort }) => updateGroup.mutateAsync({ id, patch: { sort } }))));

  const moveMonitor = (list: Monitor[], index: number, dir: -1 | 1) =>
    run(() => Promise.all(reorderPatches(list, index, dir).map(({ id, sort }) => patchMonitor.mutateAsync({ id, patch: { sort } }))));

  return (
    <div className="flex max-w-[772px] flex-col gap-6">
      {header}
      <Card title="Public URL" description="Where visitors see your status page.">
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-text">{origin}</code>
          <CopyButton value={origin} />
          <Button asChild variant="secondary" size="sm">
            <a href="/" target="_blank" rel="noreferrer">
              <ExternalLink size={14} aria-hidden />
              Open
            </a>
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Site name is in <Link to="/settings" className="text-accent-text underline">Settings</Link>.
        </p>
      </Card>
      <Card title="What visitors see" description="Groups and monitors appear in this order. Private monitors are checked and alert as usual, but are not listed.">
        {sections.length === 0 ? (
          <p className="text-sm text-muted">Nothing to show yet. Add a monitor to get started.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {sections.map((section) => {
              const groupIndex = section.group ? sortedGroups.findIndex((g) => g.id === section.group!.id) : -1;
              return (
                <section key={section.id} aria-label={section.name} className="flex flex-col">
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                    <h3 className="text-sm font-semibold text-text">{section.name}</h3>
                    {section.group ? (
                      <OrderButtons name={section.name} index={groupIndex} count={sortedGroups.length} disabled={busy} onMove={(dir) => void moveGroup(groupIndex, dir)} />
                    ) : null}
                  </div>
                  {section.monitors.length === 0 ? (
                    <p className="py-3 pl-4 text-sm text-muted">No monitors in this group.</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {section.monitors.map((m, i) => (
                        <MonitorRow
                          key={m.id}
                          monitor={m}
                          index={i}
                          count={section.monitors.length}
                          busy={busy}
                          onMove={(dir) => void moveMonitor(section.monitors, i, dir)}
                          onTogglePublic={(isPublic) => void run(() => patchMonitor.mutateAsync({ id: m.id, patch: { isPublic } }))}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
