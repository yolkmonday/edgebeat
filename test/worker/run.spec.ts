import { afterEach, describe, expect, it, vi } from "vitest";
import { runChecks, type RunnableMonitor } from "@/checks/run";

const mk = (i: number, timeoutMs = 2000): RunnableMonitor => ({
  type: "http",
  id: `m${i}`,
  url: `https://example.com/${i}`,
  method: "GET",
  headers: {},
  body: null,
  expectedStatus: "200-299",
  timeoutMs,
  followRedirects: true,
  keyword: null,
  keywordMode: "contains",
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => vi.unstubAllGlobals());

describe("runChecks", () => {
  it("bounds concurrency and returns all results in order", async () => {
    let inFlight = 0;
    let max = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        inFlight++;
        max = Math.max(max, inFlight);
        await sleep(100);
        inFlight--;
        return new Response("ok");
      }),
    );
    const ms = Array.from({ length: 12 }, (_, i) => mk(i));
    const { results, notStarted } = await runChecks(ms, {
      concurrency: 6,
      retryBudget: 0,
      deadlineAt: Date.now() + 10_000,
      now: Date.now,
      subrequestBudget: 1000,
    });
    expect(results).toHaveLength(12);
    expect(results.map((r) => r.monitorId)).toEqual(ms.map((m) => m.id));
    expect(notStarted).toEqual([]);
    expect(max).toBeLessThanOrEqual(6);
    expect(max).toBeGreaterThan(1);
  });

  it("limits retries to the shared budget", async () => {
    const fetchStub = vi.fn(async () => new Response("bad", { status: 500 }));
    vi.stubGlobal("fetch", fetchStub);
    const { results } = await runChecks([mk(1), mk(2), mk(3)], {
      concurrency: 3,
      retryBudget: 2,
      deadlineAt: Date.now() + 10_000,
      now: Date.now,
      subrequestBudget: 1000,
    });
    expect(fetchStub).toHaveBeenCalledTimes(5);
    expect(results.every((r) => !r.ok)).toBe(true);
  });

  it("retry result replaces a flaky first failure", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (n++ === 0 ? new Response("x", { status: 500 }) : new Response("ok"))),
    );
    const { results } = await runChecks([mk(1)], {
      concurrency: 1,
      retryBudget: 1,
      deadlineAt: Date.now() + 10_000,
      now: Date.now,
      subrequestBudget: 1000,
    });
    expect(results[0]).toMatchObject({ ok: true, code: 200 });
  });

  it("stops at the deadline with 20 hanging monitors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_res, rej) => {
            init?.signal?.addEventListener("abort", () =>
              rej(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    const t0 = Date.now();
    const ms = Array.from({ length: 20 }, (_, i) => mk(i, 10_000));
    const { results, notStarted } = await runChecks(ms, {
      concurrency: 5,
      retryBudget: 5,
      deadlineAt: t0 + 300,
      now: Date.now,
      subrequestBudget: 1000,
    });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(notStarted.length).toBeGreaterThan(0);
    expect(results.length + notStarted.length).toBe(20);
    expect(results.every((r) => !r.ok && r.error === "timeout")).toBe(true);
  });

  it("caps subrequests across checks, redirect hops and retries; the rest are not started", async () => {
    // every check is one redirect hop + the final fetch = 2 subrequests
    const fetchStub = vi.fn(async (u: RequestInfo | URL) =>
      new URL(String(u)).pathname.startsWith("/final")
        ? new Response("ok")
        : new Response(null, { status: 302, headers: { location: `/final${new URL(String(u)).pathname}` } }),
    );
    vi.stubGlobal("fetch", fetchStub);
    const ms = Array.from({ length: 10 }, (_, i) => mk(i));
    const { results, notStarted } = await runChecks(ms, {
      concurrency: 1,
      retryBudget: 4,
      deadlineAt: Date.now() + 10_000,
      now: Date.now,
      subrequestBudget: 7,
    });
    expect(results.map((r) => r.monitorId)).toEqual(["m0", "m1", "m2"]);
    // m3 got its first hop, then ran out mid-chain: not run, carried
    expect(notStarted).toEqual(["m3", "m4", "m5", "m6", "m7", "m8", "m9"]);
    expect(fetchStub).toHaveBeenCalledTimes(7);
  });

  it("a retry without a subrequest keeps the first result", async () => {
    const fetchStub = vi.fn(async () => new Response("bad", { status: 500 }));
    vi.stubGlobal("fetch", fetchStub);
    const { results, notStarted } = await runChecks([mk(1)], {
      concurrency: 1,
      retryBudget: 4,
      deadlineAt: Date.now() + 10_000,
      now: Date.now,
      subrequestBudget: 1,
    });
    expect(results).toEqual([expect.objectContaining({ monitorId: "m1", ok: false, error: "status" })]);
    expect(notStarted).toEqual([]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("a runtime 'Too many subrequests' error leaves the check not started", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Too many subrequests.");
      }),
    );
    const { results, notStarted } = await runChecks([mk(1), mk(2)], {
      concurrency: 1,
      retryBudget: 4,
      deadlineAt: Date.now() + 10_000,
      now: Date.now,
      subrequestBudget: 1000,
    });
    expect(results).toEqual([]);
    expect(notStarted).toEqual(["m1", "m2"]);
  });
});
