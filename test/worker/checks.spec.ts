import { afterEach, describe, expect, it, vi } from "vitest";
import { runHttpCheck, type HttpMonitor } from "@/checks/http";

const base: HttpMonitor = {
  id: "m1",
  url: "https://example.com/",
  method: "GET",
  headers: {},
  body: null,
  expectedStatus: "200-299",
  timeoutMs: 2000,
  followRedirects: true,
  keyword: null,
  keywordMode: "contains",
};

const stubFetch = (impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  vi.stubGlobal("fetch", vi.fn(impl));

afterEach(() => vi.unstubAllGlobals());

describe("runHttpCheck", () => {
  it("ok with keyword present", async () => {
    stubFetch(async () => new Response("hello world"));
    const r = await runHttpCheck({ ...base, keyword: "world" }, 2000);
    expect(r).toMatchObject({ monitorId: "m1", ok: true, code: 200, error: null });
    expect(Number.isInteger(r.latencyMs)).toBe(true);
  });

  it("sends user agent and redirect mode", async () => {
    const spy = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response("x"));
    vi.stubGlobal("fetch", spy);
    await runHttpCheck({ ...base, followRedirects: false }, 2000);
    const init = spy.mock.calls[0]![1]!;
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers as Record<string, string>).get("user-agent")).toBe("Edgebeat/1 (+https://edgebeat.sh)");
  });

  it("status mismatch", async () => {
    stubFetch(async () => new Response("boom", { status: 500 }));
    const r = await runHttpCheck(base, 2000);
    expect(r).toMatchObject({ ok: false, error: "status", code: 500 });
  });

  it("3xx matches expectedStatus when not following redirects", async () => {
    stubFetch(async () => new Response(null, { status: 301, headers: { location: "/x" } }));
    const r = await runHttpCheck({ ...base, followRedirects: false, expectedStatus: "301" }, 2000);
    expect(r).toMatchObject({ ok: true, code: 301 });
  });

  it("keyword missing", async () => {
    stubFetch(async () => new Response("nothing here"));
    const r = await runHttpCheck({ ...base, keyword: "world" }, 2000);
    expect(r).toMatchObject({ ok: false, error: "keyword", code: 200 });
  });

  it("not_contains fails when keyword present", async () => {
    stubFetch(async () => new Response("an error page"));
    const r = await runHttpCheck({ ...base, keyword: "error", keywordMode: "not_contains" }, 2000);
    expect(r).toMatchObject({ ok: false, error: "keyword" });
  });

  it("caps body read at 64 KB", async () => {
    const chunk = new Uint8Array(16 * 1024).fill(97);
    let pulled = 0;
    let cancelled = false;
    const total = 5 * 1024 * 1024;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled * chunk.length >= total) return controller.close();
        pulled += 1;
        // keyword only after the 64 KB cap
        controller.enqueue(pulled === 5 ? new TextEncoder().encode("NEEDLE".padEnd(chunk.length, "a")) : chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    stubFetch(async () => new Response(stream));
    const t0 = Date.now();
    const r = await runHttpCheck({ ...base, keyword: "NEEDLE" }, 2000);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r).toMatchObject({ ok: false, error: "keyword" });
    expect(cancelled).toBe(true);
    expect(pulled * chunk.length).toBeLessThanOrEqual(65_536 + chunk.length * 2);
  });

  it("multi-byte char split at the cap does not throw", async () => {
    const bytes = new Uint8Array(65_535).fill(97);
    const tail = new TextEncoder().encode("é€");
    const all = new Uint8Array(bytes.length + tail.length);
    all.set(bytes);
    all.set(tail, bytes.length);
    stubFetch(async () => new Response(all));
    const r = await runHttpCheck({ ...base, keyword: "zzz" }, 2000);
    expect(r).toMatchObject({ error: "keyword" });
  });

  it("timeout before headers", async () => {
    stubFetch(
      (_i, init) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
        }),
    );
    const t0 = Date.now();
    const r = await runHttpCheck(base, 200);
    expect(r).toMatchObject({ ok: false, error: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("timeout while body stalls", async () => {
    stubFetch(async (_i, init) => {
      const stream = new ReadableStream<Uint8Array>({
        pull: () =>
          new Promise((_res, rej) => {
            init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
          }),
      });
      return new Response(stream);
    });
    const t0 = Date.now();
    const r = await runHttpCheck({ ...base, keyword: "x" }, 200);
    expect(r).toMatchObject({ ok: false, error: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("connect error never throws", async () => {
    stubFetch(async () => {
      throw new TypeError("Network connection lost.");
    });
    const r = await runHttpCheck(base, 2000);
    expect(r).toMatchObject({ ok: false, error: "connect", code: null });
  });
});
