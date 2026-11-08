import { describe, expect, test } from "bun:test";
import { evaluate, type EvalOpts, type PrevState } from "./evaluate";
import type { CheckResult } from "./types";

const opts = (o: Partial<EvalOpts> = {}): EvalOpts => ({
  confirmations: 2,
  degradedThresholdMs: null,
  inMaintenance: false,
  paused: false,
  ...o,
});
const ok = (latencyMs = 100): CheckResult => ({ monitorId: "m", ok: true, latencyMs, code: 200, error: null });
const fail: CheckResult = { monitorId: "m", ok: false, latencyMs: null, code: null, error: "timeout" };
const prev = (state: PrevState["state"], consecutiveFailures = 0): PrevState => ({ state, consecutiveFailures });

describe("evaluate", () => {
  test("paused wins over everything", () => {
    const r = evaluate(prev("down", 3), fail, opts({ paused: true, inMaintenance: true }));
    expect(r.next).toEqual({ state: "paused", consecutiveFailures: 0 });
    expect(r.transition).toEqual({ from: "down", to: "paused" });
    expect(r.changed).toBe(true);
  });
  test("maintenance overrides result", () => {
    const r = evaluate(prev("up"), fail, opts({ inMaintenance: true }));
    expect(r.next).toEqual({ state: "maintenance", consecutiveFailures: 0 });
    expect(r.transition).toEqual({ from: "up", to: "maintenance" });
  });
  test("first failure keeps up, counts failure", () => {
    const r = evaluate(prev("up"), fail, opts());
    expect(r.next).toEqual({ state: "up", consecutiveFailures: 1 });
    expect(r.changed).toBe(true);
    expect(r.transition).toBeNull();
  });
  test("second failure goes down", () => {
    const r = evaluate(prev("up", 1), fail, opts());
    expect(r.next).toEqual({ state: "down", consecutiveFailures: 2 });
    expect(r.transition).toEqual({ from: "up", to: "down" });
  });
  test("pending stays pending below confirmations", () => {
    const r = evaluate(prev("pending"), fail, opts());
    expect(r.next).toEqual({ state: "pending", consecutiveFailures: 1 });
    expect(r.transition).toBeNull();
  });
  test("down + ok recovers to up", () => {
    const r = evaluate(prev("down", 5), ok(), opts());
    expect(r.next).toEqual({ state: "up", consecutiveFailures: 0 });
    expect(r.transition).toEqual({ from: "down", to: "up" });
  });
  test("up + ok with zero failures is unchanged", () => {
    const r = evaluate(prev("up"), ok(), opts());
    expect(r.changed).toBe(false);
    expect(r.transition).toBeNull();
  });
  test("slow latency is degraded", () => {
    const r = evaluate(prev("up"), ok(900), opts({ degradedThresholdMs: 800 }));
    expect(r.next.state).toBe("degraded");
    expect(r.transition).toEqual({ from: "up", to: "degraded" });
  });
  test("latency at threshold is up", () => {
    expect(evaluate(prev("up"), ok(800), opts({ degradedThresholdMs: 800 })).next.state).toBe("up");
  });
  test("null threshold never degrades", () => {
    expect(evaluate(prev("up"), ok(99999), opts()).next.state).toBe("up");
  });
  test("confirmations 1 goes down immediately", () => {
    expect(evaluate(prev("up"), fail, opts({ confirmations: 1 })).next.state).toBe("down");
  });
  test("down stays down on further failure, counter increments", () => {
    const r = evaluate(prev("down", 2), fail, opts());
    expect(r.next).toEqual({ state: "down", consecutiveFailures: 3 });
    expect(r.transition).toBeNull();
    expect(r.changed).toBe(true);
  });
  test("maintenance + one fail leaves maintenance as pending", () => {
    const r = evaluate(prev("maintenance"), fail, opts());
    expect(r.next).toEqual({ state: "pending", consecutiveFailures: 1 });
    expect(r.transition).toEqual({ from: "maintenance", to: "pending" });
    expect(r.changed).toBe(true);
  });
  test("paused + one fail leaves paused as pending", () => {
    const r = evaluate(prev("paused"), fail, opts());
    expect(r.next).toEqual({ state: "pending", consecutiveFailures: 1 });
    expect(r.transition).toEqual({ from: "paused", to: "pending" });
    expect(r.changed).toBe(true);
  });
  test("paused + ok goes up", () => {
    const r = evaluate(prev("paused"), ok(), opts());
    expect(r.next).toEqual({ state: "up", consecutiveFailures: 0 });
    expect(r.transition).toEqual({ from: "paused", to: "up" });
    expect(r.changed).toBe(true);
  });
  test("maintenance + ok goes up", () => {
    const r = evaluate(prev("maintenance"), ok(), opts());
    expect(r.next.state).toBe("up");
    expect(r.transition).toEqual({ from: "maintenance", to: "up" });
    expect(r.changed).toBe(true);
  });
  test("degraded + fast ok goes up", () => {
    const r = evaluate(prev("degraded"), ok(100), opts({ degradedThresholdMs: 800 }));
    expect(r.next.state).toBe("up");
    expect(r.transition).toEqual({ from: "degraded", to: "up" });
    expect(r.changed).toBe(true);
  });
  test("paused + failure reaching confirmations goes down", () => {
    const r = evaluate(prev("paused", 1), fail, opts());
    expect(r.next.state).toBe("down");
  });
});
