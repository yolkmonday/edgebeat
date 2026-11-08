import { describe, expect, test } from "bun:test";
import { checkBudget, isDue, selectChecks, slotOf, type SchedMonitor } from "./schedule";

const INTERVALS = [1, 2, 3, 5, 10, 15, 30, 60];
const mon = (id: string, intervalMin = 1, type: SchedMonitor["type"] = "http"): SchedMonitor => ({
  id,
  intervalMin,
  type,
});

describe("slotOf", () => {
  test("deterministic and within range", () => {
    for (const interval of INTERVALS) {
      for (let i = 0; i < 1000; i++) {
        const id = crypto.randomUUID();
        const slot = slotOf(id, interval);
        expect(slot).toBe(slotOf(id, interval));
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(interval);
      }
    }
  });
  test("interval 1 is always slot 0", () => {
    expect(slotOf("x", 1)).toBe(0);
  });
});

describe("isDue", () => {
  test("each monitor due exactly once per interval", () => {
    const monitors = Array.from({ length: 100 }, (_, i) => mon(`m${i}`, 5));
    const counts = new Map<string, number>();
    for (let minute = 1000; minute < 1005; minute++) {
      for (const m of monitors) {
        if (isDue(m, minute)) counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(100);
    for (const c of counts.values()) expect(c).toBe(1);
  });
});

describe("selectChecks", () => {
  const fifty = Array.from({ length: 50 }, (_, i) => mon(`m${String(i).padStart(2, "0")}`));

  test("overflow carries and runs first next minute", () => {
    const first = selectChecks(fifty, [], 100, 40);
    expect(first.run.length).toBe(40);
    expect(first.carry.length).toBe(10);
    const next = selectChecks(fifty.map((m) => ({ ...m, intervalMin: 60 })), first.carry, 101, 40);
    expect(next.run.slice(0, 10)).toEqual(first.carry);
  });

  test("carried id of deleted monitor is dropped", () => {
    const r = selectChecks([mon("a", 60)], ["gone", "a"], 1, 40);
    expect(r.run).toEqual(["a"]);
    expect(r.carry).toEqual([]);
  });

  test("heartbeat monitors never run", () => {
    const r = selectChecks([mon("hb", 1, "heartbeat")], ["hb"], 1, 40);
    expect(r.run).toEqual([]);
    expect(r.carry).toEqual([]);
  });

  test("deduplicates carried and due", () => {
    const r = selectChecks([mon("a"), mon("b")], ["b"], 1, 40);
    expect(r.run).toEqual(["b", "a"]);
  });
});

describe("checkBudget", () => {
  test("plans and override", () => {
    expect(checkBudget("free")).toBe(40);
    expect(checkBudget("paid")).toBe(500);
    expect(checkBudget("free", 25)).toBe(25);
  });
});
