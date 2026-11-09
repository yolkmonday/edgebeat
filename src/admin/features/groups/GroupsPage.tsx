import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Group } from "@shared/admin-api";
import { useDeleteGroup, useGroups, useUpdateGroup } from "@/api/use-groups";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TCell, THead, TRow } from "@/components/ui/table";
import { GroupDialog } from "@/features/groups/GroupDialog";
import { OrderButtons } from "@/features/groups/OrderButtons";
import { reorderPatches } from "@/features/groups/reorder";

type DialogState = { kind: "closed" } | { kind: "create" } | { kind: "edit"; group: Group };

export default function GroupsPage() {
  const groups = useGroups();
  const update = useUpdateGroup();
  const remove = useDeleteGroup();
  const [dialog, setDialog] = useState<DialogState>({ kind: "closed" });
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [moving, setMoving] = useState(false);

  const sorted = [...(groups.data ?? [])].sort((a, b) => a.sort - b.sort);
  const nextSort = sorted.length === 0 ? 0 : Math.max(...sorted.map((g) => g.sort)) + 1;

  const move = async (index: number, dir: -1 | 1) => {
    setMoving(true);
    try {
      await Promise.all(reorderPatches(sorted, index, dir).map(({ id, sort }) => update.mutateAsync({ id, patch: { sort } })));
    } catch {
      toast.error("Couldn't change the order");
    } finally {
      setMoving(false);
    }
  };

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success(`Deleted ${deleting.name}`);
        setDeleting(null);
      },
      onError: () => toast.error("Couldn't delete the group"),
    });
  };

  const addButton = (
    <Button icon={Plus} onClick={() => setDialog({ kind: "create" })}>
      Add group
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Groups" actions={sorted.length > 0 ? addButton : undefined} />
      {groups.isPending ? (
        <Skeleton className="h-48" />
      ) : groups.isError ? (
        <EmptyState
          illustration="error"
          title="Couldn't load groups"
          body="Check your connection and try again."
          actions={<Button variant="secondary" onClick={() => void groups.refetch()}>Try again</Button>}
        />
      ) : sorted.length === 0 ? (
        <EmptyState title="No groups yet" body="Groups list monitors together on your status page." actions={addButton} />
      ) : (
        <Table>
          <THead>
            <TRow>
              <TCell head>Name</TCell>
              <TCell head>Slug</TCell>
              <TCell head className="text-right">Monitors</TCell>
              <TCell head>Order</TCell>
              <TCell head className="text-right">
                <span className="sr-only">Actions</span>
              </TCell>
            </TRow>
          </THead>
          <TBody>
            {sorted.map((g, i) => (
              <TRow key={g.id}>
                <TCell className="font-medium text-text">{g.name}</TCell>
                <TCell className="font-mono text-xs text-muted">{g.slug}</TCell>
                <TCell numeric>{g.monitorCount}</TCell>
                <TCell>
                  <OrderButtons name={g.name} index={i} count={sorted.length} disabled={moving} onMove={(dir) => void move(i, dir)} />
                </TCell>
                <TCell className="text-right">
                  <span className="inline-flex gap-1">
                    <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setDialog({ kind: "edit", group: g })}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDeleting(g)}>
                      Delete
                    </Button>
                  </span>
                </TCell>
              </TRow>
            ))}
          </TBody>
        </Table>
      )}
      <GroupDialog
        key={dialog.kind === "edit" ? dialog.group.id : dialog.kind}
        open={dialog.kind !== "closed"}
        onOpenChange={(open) => !open && setDialog({ kind: "closed" })}
        group={dialog.kind === "edit" ? dialog.group : undefined}
        nextSort={nextSort}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "group"}?`}
        body={`Its ${deleting?.monitorCount ?? 0} monitors stay, without a group.`}
        confirmLabel="Delete group"
        destructive
        loading={remove.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
