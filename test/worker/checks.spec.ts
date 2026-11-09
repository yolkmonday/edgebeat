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
    expect(Number.isInteger(r!.latencyMs)).toBe(true);
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

describe("runHttpCheck redirects and subrequests", () => {
  const redirect = (status: number, location: string) => new Response(null, { status, headers: { location } });
  const counter = (limit = Infinity) => {
    const c = { taken: 0, take: () => (c.taken < limit ? (c.taken++, true) : false) };
    return c;
  };

  it("follows a relative redirect manually and takes one subrequest per hop", async () => {
    const spy = vi.fn(async (u: RequestInfo | URL, _init?: RequestInit) =>
      String(u) === "https://example.com/a/b" ? redirect(302, "../next") : new Response("done"),
    );
    vi.stubGlobal("fetch", spy);
    const c = counter();
    const r = await runHttpCheck({ ...base, url: "https://example.com/a/b" }, 2000, c.take);
    expect(r).toMatchObject({ ok: true, code: 200 });
    expect(spy.mock.calls.map(([u]) => String(u))).toEqual(["https://example.com/a/b", "https://example.com/next"]);
    expect(spy.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    expect(c.taken).toBe(2);
  });

  it("does not follow when followRedirects is false", async () => {
    const spy = vi.fn(async () => redirect(302, "/next"));
    vi.stubGlobal("fetch", spy);
    const r = await runHttpCheck({ ...base, followRedirects: false }, 2000);
    expect(r).toMatchObject({ ok: false, error: "status", code: 302 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a redirect to a private literal fails as other", async () => {
    const spy = vi.fn(async () => redirect(301, "http://127.0.0.1/admin"));
    vi.stubGlobal("fetch", spy);
    const r = await runHttpCheck(base, 2000);
    expect(r).toMatchObject({ ok: false, error: "other" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("more than 5 redirects fails as other", async () => {
    const spy = vi.fn(async () => redirect(302, "/loop"));
    vi.stubGlobal("fetch", spy);
    const r = await runHttpCheck(base, 2000);
    expect(r).toMatchObject({ ok: false, error: "other" });
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it("303 switches to GET without a body; 307 keeps method and body", async () => {
    const spy = vi.fn(async (u: RequestInfo | URL, _init?: RequestInit) => {
      const path = new URL(String(u)).pathname;
      if (path === "/") return redirect(303, "/see");
      if (path === "/see") return redirect(307, "/temp");
      return new Response("ok");
    });
    vi.stubGlobal("fetch", spy);
    await runHttpCheck({ ...base, method: "POST", body: "x" }, 2000);
    expect(spy.mock.calls.map(([, init]) => [init?.method, init?.body])).toEqual([
      ["POST", "x"],
      ["GET", null],
      ["GET", null],
    ]);
  });

  it("is not run (null) when no subrequest is available, also mid-chain", async () => {
    const spy = vi.fn(async () => redirect(302, "/next"));
    vi.stubGlobal("fetch", spy);
    expect(await runHttpCheck(base, 2000, () => false)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(await runHttpCheck(base, 2000, counter(1).take)).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a thrown 'Too many subrequests' error means not run", async () => {
    stubFetch(async () => {
      throw new Error("Too many subrequests.");
    });
    expect(await runHttpCheck(base, 2000)).toBeNull();
  });

  it("invalid header or GET with body fails as other without fetching", async () => {
    const spy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", spy);
    expect(await runHttpCheck({ ...base, headers: { "bad name": "x" } }, 2000)).toMatchObject({ ok: false, error: "other" });
    expect(await runHttpCheck({ ...base, method: "GET", body: "x" }, 2000)).toMatchObject({ ok: false, error: "other" });
    expect(spy).not.toHaveBeenCalled();
  });
});
