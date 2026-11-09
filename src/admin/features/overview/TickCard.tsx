import { Activity, ClockAlert, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { duration } from "@/lib/format";
import type { TickStatus } from "@/features/overview/tick-status";

const WORKER_URL = "https://dash.cloudflare.com/?to=/:account/workers/services/view/edgebeat";

type Copy = { title: string; detail: string };

const copyFor = (status: TickStatus): Copy => {
  if (status.kind === "waiting") {
    return { title: "Waiting for the first check", detail: "The cron runs every minute; this updates on its own." };
  }
  if (status.kind === "stale") {
    return { title: "Monitoring has stopped", detail: `Last check ${duration(status.secondsAgo)} ago · expected every minute` };
  }
  return {
    title: "Monitoring is running",
    detail: `Last check ${status.secondsAgo} s ago · next in ${status.nextInS} s · cron runs every minute`,
  };
};

export const TickCard = ({ status }: { status: TickStatus }) => {
  const { title, detail } = copyFor(status);
  const stale = status.kind === "stale";
  const waiting = status.kind === "waiting";
  const Icon = stale ? ClockAlert : Activity;
  return (
    <section
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center justify-between gap-6 rounded-lg border p-6",
        stale ? "border-border-strong bg-surface-2" : "border-border bg-surface shadow-[0_1px_2px_var(--shadow)] dark:shadow-[0_0_0_1px_var(--dark-ring)]",
      )}
    >
      <div className="flex items-center gap-4">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md border",
            stale || waiting ? "border-border bg-surface text-muted" : "border-up-border bg-up-bg text-up-text",
          )}
        >
          <Icon size={20} aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-lg font-semibold tracking-[-0.01em] text-text">{title}</h2>
          <p className="font-mono text-xs text-muted">{detail}</p>
        </div>
      </div>
      {waiting ? null : (
        <div className="flex max-w-xl flex-1 gap-3 border-l border-border pl-6 text-xs text-muted">
          {stale ? (
            <div className="flex flex-col items-start gap-3">
              <p>Your public page now shows Status unknown for every monitor. Check that the Worker&apos;s cron trigger is on in Cloudflare.</p>
              <Button asChild variant="secondary" size="sm">
                <a href={WORKER_URL} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} aria-hidden />
                  Open Worker in Cloudflare
                </a>
              </Button>
            </div>
          ) : (
            <>
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
              <p>If checks stop for 3 minutes, this card turns grey and your public page shows Status unknown, never green.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
};
