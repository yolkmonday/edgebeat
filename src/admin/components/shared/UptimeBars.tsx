import { useEffect, useState } from "react";
import type { Bar } from "../../../core/stats";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const barColor = (uptime: number | null) => {
  if (uptime === null) return "bg-unknown";
  if (uptime >= 1) return "bg-up";
  if (uptime >= 0.99) return "bg-lime";
  if (uptime >= 0.95) return "bg-degraded";
  return "bg-down";
};

/** 90 bars from 640 px, 60 from 400 px, 30 below; callers use it so titles match what is drawn. */
export const useVisibleBarCount = () => {
  const count = () => (window.innerWidth < 400 ? 30 : window.innerWidth < 640 ? 60 : 90);
  const [n, setN] = useState(count);
  useEffect(() => {
    const onResize = () => setN(count());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return n;
};

const describe = (bar: Bar) => {
  if (bar.uptime === null) return "No data";
  const pct = `${(bar.uptime * 100).toFixed(2)}% uptime`;
  const mins = Math.round(bar.downtimeS / 60);
  return mins > 0 ? `${pct}, ${mins} min down` : pct;
};

export type UptimeBarsProps = { bars: Bar[]; className?: string };

export const UptimeBars = ({ bars, className }: UptimeBarsProps) => {
  const visible = bars.slice(-useVisibleBarCount());
  return (
    <div role="img" aria-label={`Uptime over the last ${visible.length} days`} className={cn("flex h-8 w-full items-stretch gap-[2px]", className)}>
      {visible.map((bar) => (
        <Tooltip
          key={bar.day}
          content={
            <span className="flex flex-col">
              <span className="font-mono">{bar.day}</span>
              <span className="text-tooltip-muted">{describe(bar)}</span>
            </span>
          }
        >
          <span tabIndex={0} aria-label={`${bar.day}: ${describe(bar)}`} className={cn("min-w-0 flex-1 rounded-[2px]", barColor(bar.uptime))} />
        </Tooltip>
      ))}
    </div>
  );
};
