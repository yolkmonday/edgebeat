import { describe, expect, it } from "bun:test";
import { parseUsage } from "@/lib/cf-analytics";

const body = (workers: unknown, d1: unknown) =>
  ({ data: { viewer: { accounts: [{ workers, d1 }] } } }) as Parameters<typeof parseUsage>[0];

describe("parseUsage", () => {
  it("reads both fields", () => {
    expect(parseUsage(body([{ sum: { requests: 7 } }], [{ sum: { rowsWritten: 9 } }]))).toEqual({ requests: 7, d1Writes: 9 });
  });
  it("parses fields independently", () => {
    expect(parseUsage(body([{ sum: { requests: 7 } }], null))).toEqual({ requests: 7, d1Writes: null });
    expect(parseUsage(body([{ sum: { requests: "x" } }], [{ sum: { rowsWritten: 3 } }]))).toEqual({ requests: null, d1Writes: 3 });
  });
  it("treats empty groups as zero", () => {
    expect(parseUsage(body([], []))).toEqual({ requests: 0, d1Writes: 0 });
  });
  it("fails when nothing usable came back", () => {
    expect(parseUsage(body(null, null))).toBeNull();
    expect(parseUsage({ data: null, errors: [{ message: "denied" }] })).toBeNull();
  });
});
