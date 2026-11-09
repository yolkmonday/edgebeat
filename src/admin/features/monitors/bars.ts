import type { Bar } from "../../../core/stats";

/** Observed-weighted uptime (0..1) over the bars; `null` when nothing was observed. */
export const uptimeFromBars = (bars: Bar[]): number | null => {
  const observed = bars.reduce((sum, b) => sum + (b.uptime === null ? 0 : b.observedS), 0);
  if (observed <= 0) return null;
  const down = bars.reduce((sum, b) => sum + (b.uptime === null ? 0 : b.downtimeS), 0);
  return Math.max(0, 1 - down / observed);
};
