import { useState } from "react";
import { Copy, ExternalLink, MoreHorizontal, Pause, Pencil, Play, RefreshCw, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import type { Monitor } from "@shared/admin-api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDeleteMonitor, useTestCheck, useUpdateMonitor } from "@/api/use-monitors";
import { isApiError } from "@/lib/api";
import { budgetExceededMessage } from "@/features/monitors/budget-error";
import { reportCheck } from "@/features/monitors/check-result";

export type MonitorRowActionsProps = { monitor: Monitor; /** Where to go after a delete started from a detail page. */ afterDelete?: string };

export const MonitorRowActions = ({ monitor: m, afterDelete }: MonitorRowActionsProps) => {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const update = useUpdateMonitor(m.id);
  const remove = useDeleteMonitor();
  const check = useTestCheck(m.id);

  const togglePause = () =>
    update.mutate(
      { paused: !m.paused },
      {
        onSuccess: () => toast.success(m.paused ? `${m.name} resumed` : `${m.name} paused`),
        onError: (e) => toast.error("Could not update the monitor", { description: budgetExceededMessage(e) ?? (isApiError(e) ? e.code : undefined) }),
      },
    );

  const runCheck = () =>
    check.mutate(undefined, {
      onSuccess: (r) => reportCheck(m.name, r),
      onError: (e) => toast.error("Could not run the check", { description: isApiError(e) && e.code === "too_many_checks" ? "Too many checks. Wait a moment." : undefined }),
    });

  const copyBeat = async () => {
    if (!m.beatUrl) return;
    try {
      await navigator.clipboard.writeText(m.beatUrl);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const doDelete = () =>
    remove.mutate(m.id, {
      onSuccess: () => {
        setConfirmOpen(false);
        toast.success(`${m.name} deleted`);
        if (afterDelete) navigate(afterDelete);
      },
      onError: () => toast.error("Could not delete the monitor"),
    });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${m.name}`}
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-3 hover:text-text"
        >
          <MoreHorizontal size={16} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem asChild>
            <Link to={`/monitors/${m.id}`}>
              <ExternalLink size={14} aria-hidden />
              Open
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={`/monitors/${m.id}/edit`}>
              <Pencil size={14} aria-hidden />
              Edit
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={togglePause}>
            {m.paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
            {m.paused ? "Resume" : "Pause"}
          </DropdownMenuItem>
          {m.type === "heartbeat" && m.beatUrl ? (
            <DropdownMenuItem onSelect={copyBeat}>
              <Copy size={14} aria-hidden />
              Copy beat URL
            </DropdownMenuItem>
          ) : null}
          {m.type !== "heartbeat" ? (
            <DropdownMenuItem onSelect={runCheck} disabled={check.isPending}>
              <RefreshCw size={14} aria-hidden />
              Run check now
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setConfirmOpen(true)}>
            <Trash2 size={14} aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
    </>
  );
};
