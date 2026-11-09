import { describe, expect, test } from "bun:test";
import { uptimeFromBars } from "./bars";

const bar = (uptime: number | null, downtimeS: number, observedS: number) => ({ day: "2026-11-01", uptime, downtimeS, observedS });

describe("uptimeFromBars", () => {
  test("weights by observed seconds and ignores empty days", () => {
    expect(uptimeFromBars([bar(1, 0, 86_400), bar(null, 0, 0), bar(0.5, 43_200, 86_400)])).toBe(0.75);
  });
  test("null without data", () => {
    expect(uptimeFromBars([])).toBeNull();
    expect(uptimeFromBars([bar(null, 0, 0)])).toBeNull();
  });
});
