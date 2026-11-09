import { describe, expect, it } from "bun:test";
import { estimateWritesToday, ticksTodayEstimate } from "./usage";

const base = { minutesElapsed: 0, ticksToday: 0, activeChecked: 0, eventsToday: 0, heartbeatPeriodsS: [] };

describe("estimateWritesToday", () => {
  it("is zero before anything ran", () => {
    expect(estimateWritesToday(base)).toEqual({ value: 0, projected: 0 });
  });

  it("follows the documented formula", () => {
    const r = estimateWritesToday({
      minutesElapsed: 600,
      ticksToday: 600,
      activeChecked: 10,
      eventsToday: 4,
      heartbeatPeriodsS: [60],
    });
    // 600*3 + 40*11 + 4*2 + min(1200, 600) + 10*60
    expect(r.value).toBe(3448);
    expect(r.projected).toBe(Math.round((3448 * 1440) / 600));
  });

  it("coalesces beats to two writes per minute at most", () => {
    const r = estimateWritesToday({ ...base, minutesElapsed: 10, heartbeatPeriodsS: [5] });
    expect(r.value).toBe(20);
  });

  it("projects from at least 15 minutes", () => {
    const r = estimateWritesToday({ ...base, minutesElapsed: 3, ticksToday: 3 });
    expect(r.value).toBe(9);
    expect(r.projected).toBe(Math.round((9 * 1440) / 15));
  });
});

describe("ticksTodayEstimate", () => {
  const dayStart = Date.UTC(2026, 10, 9);
  it("no tick yet, or last tick before today → 0", () => {
    expect(ticksTodayEstimate(dayStart, null)).toBe(0);
    expect(ticksTodayEstimate(dayStart, dayStart - 1)).toBe(0);
  });
  it("one tick per minute up to the last tick, inclusive", () => {
    expect(ticksTodayEstimate(dayStart, dayStart + 5_000)).toBe(1);
    expect(ticksTodayEstimate(dayStart, dayStart + 90 * 60_000 + 3_000)).toBe(91);
  });
});
