import { useState } from "react";
import { MoreHorizontal, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatePill } from "@/components/shared/StatePill";
import { useDeleteMonitor, useMonitor, useUpdateMonitor } from "@/api/use-monitors";
import { isApiError } from "@/lib/api";
import { stateLabel } from "@/lib/format";
import { budgetExceededMessage } from "@/features/monitors/budget-error";
import { CheckPanel } from "@/features/monitors/CheckPanel";
import { DownExplainer } from "@/features/monitors/DownExplainer";
import { HeartbeatPanel } from "@/features/monitors/HeartbeatPanel";
import { MonitorSummary } from "@/features/monitors/MonitorSummary";
import { explainInputFromMonitor } from "@/features/monitors/down-explainer";

const Layout = ({ children }: { children: React.ReactNode }) => <div className="flex flex-col gap-6">{children}</div>;

const Detail = ({ id }: { id: string }) => {
  const navigate = useNavigate();
  const { data: m, isPending, error, refetch, dataUpdatedAt } = useMonitor(id);
  const update = useUpdateMonitor(id);
  const remove = useDeleteMonitor();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isPending && !error) {
    return (
      <Layout>
        <PageHeader title="Loading…" />
        <Skeleton className="h-64 w-full" />
      </Layout>
    );
  }

  if (!m) {
    const missing = isApiError(error) && error.status === 404;
    return (
      <EmptyState
        illustration="error"
        title={missing ? "Monitor not found" : "Couldn't load the monitor"}
        body={missing ? "It may have been deleted." : "The admin API didn't answer. Try again in a moment."}
        actions={
          <>
            {missing ? null : (
              <Button variant="secondary" onClick={() => refetch()}>
                Try again
              </Button>
            )}
            <Button asChild variant={missing ? "primary" : "ghost"}>
              <Link to="/monitors">Back to monitors</Link>
            </Button>
          </>
        }
      />
    );
  }

  const heartbeat = m.type === "heartbeat";
  const listPath = heartbeat ? "/heartbeats" : "/monitors";
  const now = dataUpdatedAt || Date.now();

  const togglePause = () =>
    update.mutate(
      { paused: !m.paused },
      {
        onSuccess: () => toast.success(m.paused ? `${m.name} resumed` : `${m.name} paused`),
        onError: (e) => toast.error("Could not update the monitor", { description: budgetExceededMessage(e) ?? undefined }),
      },
    );

  const doDelete = () =>
    remove.mutate(m.id, {
      onSuccess: () => {
        toast.success(`${m.name} deleted`);
        navigate(listPath);
      },
      onError: () => toast.error("Could not delete the monitor"),
    });

  return (
    <Layout>
      <PageHeader
        title={m.name}
        breadcrumb={[{ label: heartbeat ? "Heartbeats" : "Monitors", to: listPath }, { label: m.name }]}
        pill={<StatePill state={m.status.state} label={stateLabel(m.status.state)} />}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={m.paused ? Play : Pause} loading={update.isPending} onClick={togglePause}>
              {m.paused ? "Resume" : "Pause"}
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link to={`/monitors/${m.id}/edit`}>
                <Pencil size={14} aria-hidden />
                Edit
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="More actions"
                className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-border-strong bg-surface text-text hover:bg-surface-2"
              >
                <MoreHorizontal size={14} aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
                  <Trash2 size={14} aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,772px)_340px]">
        {heartbeat ? <HeartbeatPanel monitor={m} now={now} /> : <CheckPanel monitor={m} now={now} />}
        <aside className="flex flex-col gap-4">
          <MonitorSummary monitor={m} />
          <DownExplainer input={explainInputFromMonitor(m)} />
        </aside>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${m.name}?`}
        body={`Delete ${m.name}? Its history is deleted too. This can't be undone.`}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={doDelete}
      />
    </Layout>
  );
};

export default function MonitorDetailPage() {
  const { id } = useParams();
  return id ? <Detail key={id} id={id} /> : null;
}
