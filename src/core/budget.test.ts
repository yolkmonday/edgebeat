import { describe, expect, test } from "bun:test";
import { budgetVerdict, effectiveBudget, peakChecksPerMinute, type BudgetMonitor } from "./budget";
import { isDue } from "./schedule";

const mk = (n: number, intervalMin: number, extra: Partial<BudgetMonitor> = {}): BudgetMonitor[] =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i}`, type: "http" as const, intervalMin, paused: false, ...extra }));

describe("peakChecksPerMinute", () => {
  test("40 one-minute monitors peak at 40", () => {
    expect(peakChecksPerMinute(mk(40, 1))).toBe(40);
  });
  test("heartbeats and paused are excluded", () => {
    const ms = [...mk(3, 1), ...mk(5, 1, { type: "heartbeat" }).map((m, i) => ({ ...m, id: `h${i}` })), ...mk(4, 1, { paused: true }).map((m, i) => ({ ...m, id: `p${i}` }))];
    expect(peakChecksPerMinute(ms)).toBe(3);
  });
  test("60 five-minute monitors peak at the busiest slot bucket", () => {
    const ms = mk(60, 5);
    const expected = Math.max(...Array.from({ length: 60 }, (_, m) => ms.filter((x) => isDue(x, m)).length));
    expect(peakChecksPerMinute(ms)).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(12);
  });
  test("empty is 0", () => {
    expect(peakChecksPerMinute([])).toBe(0);
  });
});

describe("effectiveBudget", () => {
  test("free is clamped to 40, paid defaults to 500", () => {
    expect(effectiveBudget("free", null)).toBe(40);
    expect(effectiveBudget("free", 100)).toBe(40);
    expect(effectiveBudget("free", 10)).toBe(10);
    expect(effectiveBudget("paid", null)).toBe(500);
    expect(effectiveBudget("paid", 120)).toBe(120);
  });
});

describe("budgetVerdict", () => {
  test("refuses the 41st one-minute monitor on free", () => {
    const v = budgetVerdict(mk(40, 1), mk(41, 1), 40);
    expect(v).toEqual({ ok: false, used: 40, after: 41, budget: 40 });
  });
  test("allows a rename when already over budget (peak unchanged)", () => {
    const before = mk(45, 1);
    expect(budgetVerdict(before, before.map((m) => ({ ...m })), 40)).toEqual({ ok: true });
  });
  test("allows lowering", () => {
    expect(budgetVerdict(mk(45, 1), mk(44, 1), 40)).toEqual({ ok: true });
  });
  test("allows adding under budget", () => {
    expect(budgetVerdict(mk(10, 1), mk(11, 1), 40)).toEqual({ ok: true });
  });
});
