import { useState } from "react";
import { format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ApiToken } from "@shared/admin-api";
import { useSession } from "@/api/use-session";
import { useDeleteToken, useTokens } from "@/api/use-tokens";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TCell, THead, TRow } from "@/components/ui/table";
import { CreateTokenDialog } from "@/features/settings/CreateTokenDialog";
import { ago } from "@/lib/format";

const TokenList = () => {
  const tokens = useTokens();
  const remove = useDeleteToken();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);

  const confirmRevoke = () => {
    if (!revoking) return;
    remove.mutate(revoking.id, {
      onSuccess: () => {
        toast.success(`Revoked ${revoking.name}`);
        setRevoking(null);
      },
      onError: () => toast.error("Couldn't revoke the token"),
    });
  };

  const items = tokens.data ?? [];
  return (
    <Card
      className="max-w-[760px]"
      title="API tokens"
      description="Tokens let scripts and other tools call the admin API with an Authorization header."
      actions={
        <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
          Create token
        </Button>
      }
    >
      {tokens.isPending ? (
        <Skeleton className="h-20" />
      ) : tokens.isError ? (
        <p className="text-sm text-down-text">Couldn&apos;t load tokens.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No API tokens yet.</p>
      ) : (
        <Table>
          <THead>
            <TRow>
              <TCell head>Name</TCell>
              <TCell head>Scope</TCell>
              <TCell head>Token</TCell>
              <TCell head>Created</TCell>
              <TCell head>Last used</TCell>
              <TCell head className="text-right">
                <span className="sr-only">Actions</span>
              </TCell>
            </TRow>
          </THead>
          <TBody>
            {items.map((t) => (
              <TRow key={t.id}>
                <TCell className="font-medium text-text">{t.name}</TCell>
                <TCell>
                  <Badge variant={t.scope === "admin" ? "accent" : "neutral"}>{t.scope}</Badge>
                </TCell>
                <TCell className="font-mono text-xs text-muted">{t.prefix}…</TCell>
                <TCell className="text-muted">{format(new Date(t.createdAt), "MMM d, yyyy")}</TCell>
                <TCell className="text-muted">{t.lastUsedAt === null ? "Never" : ago(t.lastUsedAt, Date.now())}</TCell>
                <TCell className="text-right">
                  <Button variant="ghost" size="sm" icon={Trash2} aria-label={`Revoke ${t.name}`} onClick={() => setRevoking(t)}>
                    Revoke
                  </Button>
                </TCell>
              </TRow>
            ))}
          </TBody>
        </Table>
      )}
      <CreateTokenDialog open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke ${revoking?.name ?? "token"}?`}
        body="Anything using this token stops working right away. This can't be undone."
        confirmLabel="Revoke token"
        destructive
        loading={remove.isPending}
        onConfirm={confirmRevoke}
      />
    </Card>
  );
};

export const ApiTokensCard = () => {
  const session = useSession();
  if (session.data?.auth === "token") {
    return (
      <Card className="max-w-[760px]" title="API tokens" description="Tokens can only be managed from a signed-in browser session, not with an API token." />
    );
  }
  return <TokenList />;
};
