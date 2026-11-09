import { useEffect, useRef, useState } from "react";
import { format, isSameDay } from "date-fns";
import { LoaderCircle, RotateCw } from "lucide-react";
import { toast } from "sonner";
import type { Monitor } from "@shared/admin-api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CopyButton } from "@/components/ui/copy-button";
import { Illustration } from "@/components/shared/Illustration";
import { useRotateToken } from "@/api/use-monitors";
import { ago } from "@/lib/format";

const nextExpected = (m: Monitor, lastBeatAt: number): string => {
  const at = new Date(lastBeatAt + ((m.heartbeatPeriodS ?? 0) + (m.heartbeatGraceS ?? 0)) * 1000);
  return format(at, isSameDay(at, new Date()) ? "HH:mm" : "MMM d, HH:mm");
};

export const HeartbeatPanel = ({ monitor: m, now }: { monitor: Monitor; now: number }) => {
  const rotate = useRotateToken(m.id);
  const [rotateOpen, setRotateOpen] = useState(false);
  const lastBeatAt = m.status.lastBeatAt;
  const waiting = lastBeatAt === null;

  // toast once when the first beat arrives while this page is open
  const seenWaiting = useRef(waiting);
  useEffect(() => {
    if (waiting) {
      seenWaiting.current = true;
      return;
    }
    if (seenWaiting.current) toast.success("First beat received");
    seenWaiting.current = false;
  }, [waiting]);

  const beatUrl = m.beatUrl;
  const doRotate = () =>
    rotate.mutate(undefined, {
      onSuccess: () => {
        setRotateOpen(false);
        toast.success("Token rotated", { description: "The old URL no longer works." });
      },
      onError: () => toast.error("Could not rotate the token"),
    });

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <Illustration name="heartbeat" className="w-60 shrink-0 rounded-md" />
          <div className="flex flex-col gap-2">
            {waiting ? (
              <>
                <p className="flex items-center gap-1.5 font-mono text-xs text-accent-text">
                  <LoaderCircle size={14} className="animate-spin" aria-hidden />
                  Listening since {ago(m.createdAt, now)}
                </p>
                <h2 className="text-2xl font-semibold tracking-[-0.02em] text-text">Waiting for the first beat…</h2>
                <p className="text-sm text-muted">
                  Add the command below to the end of your job. This page updates on its own when the first beat arrives. Until then the monitor shows Pending, not Up.
                </p>
              </>
            ) : (
              <>
                <p className="font-mono text-xs text-muted">Last beat {ago(lastBeatAt, now)}</p>
                <h2 className="text-2xl font-semibold tracking-[-0.02em] text-text">Next beat expected by {nextExpected(m, lastBeatAt)}</h2>
                <p className="text-sm text-muted">If it doesn't arrive by then, {m.name} goes Down once the confirmations are used up.</p>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card title="Beat URL" description="Keep it secret. Anyone with this URL can report the job as running.">
        {beatUrl ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-sm text-text">{beatUrl}</code>
              <CopyButton value={beatUrl} size="md" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-xs text-muted">Leaked it? Rotating makes a new URL. The old one stops working right away.</p>
              <Button variant="secondary" icon={RotateCw} onClick={() => setRotateOpen(true)}>
                Rotate token
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">The beat URL isn't available. Reload the page.</p>
        )}
      </Card>

      {beatUrl ? (
        <div className="flex flex-col gap-2">
          <CodeBlock caption="Add to the end of your job" code={`curl -fsS ${beatUrl}`} />
          <p className="text-xs text-muted">
            Report a failure: <code className="font-mono">curl -fsS {beatUrl}/fail</code>
          </p>
        </div>
      ) : null}

      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title="Rotate the beat token?"
        body="This makes a new beat URL. The old one stops working right away, so update your job with the new one."
        confirmLabel="Rotate token"
        loading={rotate.isPending}
        onConfirm={doRotate}
      />
    </div>
  );
};
