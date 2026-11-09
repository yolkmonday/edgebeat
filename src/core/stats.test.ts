import { describe, expect, test } from "bun:test";
import {
  addTickResults,
  downtimeSeconds,
  emptyDay,
  LATENCY_BUCKETS_MS,
  percentile,
  rollBars,
  uptimeOf,
  utcDay,
  type Bar,
  type DayStats,
} from "./stats";
import type { CheckResult } from "./types";

const res = (ok: boolean, latencyMs: number | null = 120): CheckResult => ({
  monitorId: "m",
  ok,
  latencyMs,
  code: ok ? 200 : 500,
  error: ok ? null : "status",
});

describe("addTickResults", () => {
  test("counts checks, failures, observed seconds and histogram", () => {
    const d = addTickResults(emptyDay(), [res(true, 120), res(false, null), res(true, 99999)], 5);
    expect(d.checks).toBe(3);
    expect(d.failures).toBe(1);
    expect(d.observedS).toBe(900);
    expect(d.hist.length).toBe(14);
    expect(d.hist[2]).toBe(1);
    expect(d.hist[13]).toBe(1);
    expect(d.hist.reduce((a, b) => a + b, 0)).toBe(2);
  });
  test("does not mutate input", () => {
    const d = emptyDay();
    addTickResults(d, [res(true)], 1);
    expect(d).toEqual(emptyDay());
  });
});

describe("uptimeOf", () => {
  test("null when nothing observed", () => {
    expect(uptimeOf(emptyDay())).toBeNull();
  });
  test("full uptime", () => {
    const d: DayStats = { ...emptyDay(), checks: 1440, observedS: 86400, downtimeS: 0 };
    expect(uptimeOf(d)).toBe(1);
  });
  test("864s down over 86400s", () => {
    expect(uptimeOf({ ...emptyDay(), observedS: 86400, downtimeS: 864 })).toBe(0.99);
  });
  test("clamps at 0", () => {
    expect(uptimeOf({ ...emptyDay(), observedS: 10, downtimeS: 50 })).toBe(0);
  });
});

describe("percentile", () => {
  test("100 samples at 120ms -> 200", () => {
    let d = emptyDay();
    d = addTickResults(d, Array.from({ length: 100 }, () => res(true, 120)), 1);
    expect(percentile(d.hist, 50)).toBe(200);
    expect(percentile(d.hist, 95)).toBe(200);
  });
  test("empty -> null", () => {
    expect(percentile(emptyDay().hist, 95)).toBeNull();
  });
  test("picks bucket by rank", () => {
    const hist = new Array(14).fill(0);
    hist[0] = 90;
    hist[4] = 10;
    expect(percentile(hist, 90)).toBe(LATENCY_BUCKETS_MS[0]);
    expect(percentile(hist, 95)).toBe(LATENCY_BUCKETS_MS[4]);
  });
});

describe("downtimeSeconds", () => {
  const events = [
    { toState: "up" as const, at: 0 },
    { toState: "down" as const, at: 10_000 },
    { toState: "up" as const, at: 70_000 },
  ];
  test("down interval", () => {
    expect(downtimeSeconds(events, "up", 0, 100_000)).toBe(60);
  });
  test("unsorted events", () => {
    expect(downtimeSeconds([events[2]!, events[0]!, events[1]!], "up", 0, 100_000)).toBe(60);
  });
  test("pausing ends a down interval; paused time is not downtime", () => {
    const evs = [
      { toState: "down" as const, at: 10_000 },
      { toState: "paused" as const, at: 40_000 },
      { toState: "pending" as const, at: 90_000 },
    ];
    expect(downtimeSeconds(evs, "up", 0, 100_000)).toBe(30);
    expect(downtimeSeconds([], "paused", 0, 100_000)).toBe(0);
  });
  test("maintenance overlap subtracted", () => {
    expect(downtimeSeconds(events, "up", 0, 100_000, [[20_000, 40_000]])).toBe(40);
  });
  test("overlapping maintenance windows not double-subtracted", () => {
    expect(
      downtimeSeconds(events, "up", 0, 100_000, [
        [20_000, 40_000],
        [30_000, 50_000],
      ]),
    ).toBe(30);
  });
  test("starts down, no events", () => {
    expect(downtimeSeconds([], "down", 0, 30_000)).toBe(30);
  });
  test("clipped to range", () => {
    expect(downtimeSeconds(events, "up", 20_000, 30_000)).toBe(10);
  });
  test("still down at end of range", () => {
    expect(downtimeSeconds([{ toState: "down", at: 90_000 }], "up", 0, 100_000)).toBe(10);
  });
  test("down to maintenance ends downtime", () => {
    expect(
      downtimeSeconds(
        [
          { toState: "down", at: 0 },
          { toState: "maintenance", at: 5_000 },
        ],
        "up",
        0,
        10_000,
      ),
    ).toBe(5);
  });
});

describe("utcDay", () => {
  test("formats UTC", () => {
    expect(utcDay(Date.UTC(2026, 10, 9, 23, 59, 59))).toBe("2026-11-09");
  });
});

describe("rollBars", () => {
  const today = "2026-11-09";
  const stats: DayStats = { ...emptyDay(), checks: 10, observedS: 600, downtimeS: 60 };
  test("empty -> single today bar with observedS", () => {
    const out = rollBars([], today, stats);
    expect(out).toEqual([{ day: today, uptime: 0.9, downtimeS: 60, observedS: 600 }]);
  });
  test("replaces today's bar", () => {
    const out = rollBars([{ day: today, uptime: 1, downtimeS: 0, observedS: 5 }], today, stats);
    expect(out.length).toBe(1);
    expect(out[0]!.observedS).toBe(600);
  });
  test("fills 3-day gap with grey bars observedS 0", () => {
    const prev: Bar[] = [{ day: "2026-11-05", uptime: 1, downtimeS: 0, observedS: 86400 }];
    const out = rollBars(prev, today, stats);
    expect(out.map((b) => b.day)).toEqual([
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
    ]);
    for (const b of out.slice(1, 4)) {
      expect(b).toEqual({ day: b.day, uptime: null, downtimeS: 0, observedS: 0 });
    }
  });
  test("95 bars -> 90, oldest dropped", () => {
    const start = Date.UTC(2026, 10, 9) - 95 * 86400_000;
    const prev: Bar[] = Array.from({ length: 95 }, (_, i) => ({
      day: utcDay(start + i * 86400_000),
      uptime: 1,
      downtimeS: 0,
      observedS: 86400,
    }));
    const out = rollBars(prev, today, stats);
    expect(out.length).toBe(90);
    expect(out[0]!.day).toBe(utcDay(Date.UTC(2026, 10, 9) - 89 * 86400_000));
    expect(out[89]!.day).toBe(today);
  });
});
