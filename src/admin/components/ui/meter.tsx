import { cn } from "@/lib/utils";

export type MeterTone = "accent" | "neutral" | "warn" | "bad";

export type MeterProps = {
  value: number;
  /** `null` = unlimited: renders nothing. */
  max: number | null;
  tone?: MeterTone;
  "aria-label"?: string;
};

const FILL: Record<MeterTone, string> = {
  accent: "bg-accent",
  neutral: "bg-border-strong",
  warn: "bg-degraded",
  bad: "bg-down",
};

/** Auto-escalates to warn at 80 % and bad at 100 % unless `tone` is given. */
export const Meter = ({ value, max, tone, ...aria }: MeterProps) => {
  if (max === null || max <= 0) return null;
  const ratio = value / max;
  const resolved: MeterTone = tone ?? (ratio >= 1 ? "bad" : ratio >= 0.8 ? "warn" : "accent");
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-label={aria["aria-label"]}
      className="h-2 w-full overflow-hidden rounded-pill bg-surface-3"
    >
      <div className={cn("h-full rounded-pill transition-[width]", FILL[resolved])} style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
    </div>
  );
};
