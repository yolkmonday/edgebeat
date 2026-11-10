import type { ReactNode } from "react";
import type { Overview } from "@shared/admin-api";
import { Meter, type MeterTone } from "@/components/ui/meter";
import { compact } from "@/lib/format";
import { cn } from "@/lib/utils";

type UsageCardProps = {
  label: string;
  value: string;
  limit?: string | null;
  meter?: { value: number; max: number | null; tone?: MeterTone };
  note: ReactNode;
  bad?: boolean;
  /** false for a word ("Not tracked") instead of a number: no big mono digits. */
  numeric?: boolean;
};

const UsageCard = ({ label, value, limit, meter, note, bad, numeric = true }: UsageCardProps) => (
  <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-[0_1px_2px_var(--shadow)] dark:shadow-[0_0_0_1px_var(--dark-ring)]">
    <h3 className="text-sm text-muted">{label}</h3>
    <p className={cn("tabular-nums text-text", numeric ? "font-mono text-3xl" : "text-base font-medium leading-9")}>
      {value}
      {limit ? <span className="ml-2 text-sm text-muted">/ {limit}</span> : null}
    </p>
    {meter ? <Meter value={meter.value} max={meter.max} tone={meter.tone} aria-label={label} /> : null}
    <p className={cn("text-xs", bad ? "text-down-text" : "text-muted")}>{note}</p>
  </article>
);

/** Where the D1 number comes from, said plainly: real analytics, a fallback after a failed query, or our own estimate. */
const d1SourceNote = (analytics: Overview["usage"]["analytics"], source: Overview["usage"]["d1WritesToday"]["source"]) => {
  if (source === "analytics") return " From Cloudflare analytics (whole account).";
  if (analytics === "failed") return " Estimated: the Cloudflare analytics query failed.";
  return " Estimated from Upflare's own writes.";
};

const requestsMissingNote = (analytics: Overview["usage"]["analytics"]) =>
  analytics === "failed"
    ? "The Cloudflare analytics query failed. Check that CF_API_TOKEN has Account Analytics: Read and CF_ACCOUNT_ID is right."
    : "Add CF_ACCOUNT_ID and CF_API_TOKEN (Account Analytics: Read) secrets to see this.";

export const UsageCards = ({ usage }: { usage: Overview["usage"] }) => {
  const { checksPerMinute: cpm, d1WritesToday: d1, requestsToday: req, analytics } = usage;
  const over = cpm.used > cpm.budget;
  const left = Math.max(0, cpm.budget - cpm.used);
  return (
    <section aria-labelledby="usage-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-heading" className="text-sm font-semibold text-text">
          Cloudflare {cpm.plan} plan usage
        </h2>
        <span className="text-xs text-muted">Daily counters reset at 00:00 UTC</span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <UsageCard
          label="Checks per minute"
          value={String(cpm.used)}
          limit={String(cpm.budget)}
          meter={{ value: cpm.used, max: cpm.budget }}
          bad={over}
          note={
            over
              ? `Over budget: ${cpm.used - cpm.budget} checks wait for the next minute. Raise intervals or switch to Paid.`
              : cpm.plan === "free"
                ? `${left} left. Raise it by switching to the Paid plan in Settings.`
                : `${left} left. Raise the budget in Settings.`
          }
        />
        <UsageCard
          label="D1 writes today"
          value={compact(d1.value)}
          limit={d1.limit === null ? null : compact(d1.limit)}
          meter={{ value: d1.value, max: d1.limit, tone: "neutral" }}
          note={`On pace for about ${compact(d1.projected)} by midnight.${d1SourceNote(analytics, d1.source)}`}
          bad={analytics === "failed"}
        />
        {req ? (
          <UsageCard
            label="Worker requests today"
            value={compact(req.value)}
            limit={req.limit === null ? null : compact(req.limit)}
            meter={{ value: req.value, max: req.limit, tone: "neutral" }}
            note="Status page views, checks and heartbeats."
          />
        ) : (
          <UsageCard
            label="Worker requests today"
            numeric={false}
            value={analytics === "failed" ? "Unavailable" : "Not tracked"}
            note={requestsMissingNote(analytics)}
            bad={analytics === "failed"}
          />
        )}
      </div>
    </section>
  );
};
