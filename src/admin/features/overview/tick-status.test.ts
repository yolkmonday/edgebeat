import { describe, expect, test } from "bun:test";
import type { Overview } from "@shared/admin-api";
import { TICK_STALE_MS } from "../../../core/public-status";
import { serverNow, tickStatus } from "./tick-status";

const SERVER_NOW = 1_800_000_000_000;

const overview = (lastTickAt: number | null): Overview => ({
  now: SERVER_NOW,
  tick: { lastTickAt, stale: false },
  counts: { up: 0, degraded: 0, down: 0, maintenance: 0, paused: 0, pending: 0, unknown: 0 },
  totals: { all: 0, checks: 0, heartbeats: 0 },
  usage: {
    analytics: "off",
    checksPerMinute: { used: 0, budget: 40, plan: "free" },
    d1WritesToday: { value: 0, projected: 0, limit: 100_000, source: "estimate" },
    requestsToday: null,
  },
  recentEvents: [],
});

describe("tickStatus", () => {
  test("waiting when the cron never ran", () => {
    expect(tickStatus(overview(null), 123)).toEqual({ kind: "waiting" });
  });

  test("running uses the server clock, not the client clock", () => {
    // client clock is an hour off; only the elapsed time since fetch counts
    const clientFetchedAt = SERVER_NOW + 3_600_000;
    const status = tickStatus(overview(SERVER_NOW - 12_000), clientFetchedAt + 5_000, clientFetchedAt);
    expect(status).toEqual({ kind: "running", secondsAgo: 17, nextInS: 43 });
  });

  test("next check never goes negative", () => {
    const status = tickStatus(overview(SERVER_NOW - 100_000), SERVER_NOW);
    expect(status).toEqual({ kind: "running", secondsAgo: 100, nextInS: 0 });
  });

  test("stale exactly when older than TICK_STALE_MS", () => {
    expect(tickStatus(overview(SERVER_NOW - TICK_STALE_MS), SERVER_NOW).kind).toBe("running");
    expect(tickStatus(overview(SERVER_NOW - TICK_STALE_MS - 1), SERVER_NOW)).toEqual({ kind: "stale", secondsAgo: 180 });
  });

  test("serverNow advances with elapsed client time", () => {
    expect(serverNow(overview(null), 10_500, 10_000)).toBe(SERVER_NOW + 500);
  });
});
