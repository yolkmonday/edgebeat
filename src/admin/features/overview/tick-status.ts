import type { Overview } from "@shared/admin-api";
import { TICK_STALE_MS } from "../../../core/public-status";

const CRON_INTERVAL_S = 60;

export type TickStatus =
  | { kind: "waiting" }
  | { kind: "running"; secondsAgo: number; nextInS: number }
  | { kind: "stale"; secondsAgo: number };

/** Server time now, derived from the server clock in the response so a skewed client clock does not matter. */
export const serverNow = (overview: Overview, clientNow: number, fetchedAt: number = clientNow): number =>
  overview.now + Math.max(0, clientNow - fetchedAt);

/**
 * `fetchedAt` is the client time the overview arrived; the elapsed time since then advances the server clock.
 * Without it, `clientNow` is treated as the moment the response was produced.
 */
export const tickStatus = (overview: Overview, clientNow: number, fetchedAt: number = clientNow): TickStatus => {
  const last = overview.tick.lastTickAt;
  if (last === null) return { kind: "waiting" };
  const age = serverNow(overview, clientNow, fetchedAt) - last;
  const secondsAgo = Math.max(0, Math.floor(age / 1000));
  if (age > TICK_STALE_MS) return { kind: "stale", secondsAgo };
  return { kind: "running", secondsAgo, nextInS: Math.max(0, CRON_INTERVAL_S - secondsAgo) };
};
