import type { CheckResult, ErrorClass, KeywordMode } from "@/core/types";
import { assertMonitorUrl } from "@/lib/url-guard";

export type HttpMonitor = {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  expectedStatus: string;
  timeoutMs: number;
  followRedirects: boolean;
  keyword: string | null;
  keywordMode: KeywordMode;
};

/** Asks the runner for one subrequest; false when the per-tick cap is used up. */
export type TakeSubrequest = () => boolean;

const BODY_CAP = 65_536;
const MAX_REDIRECTS = 5;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "Edgebeat/1 (+https://edgebeat.sh)";

export const matchesStatus = (code: number, spec: string): boolean =>
  spec.split(",").some((part) => {
    const m = /^\s*(\d{3})(?:\s*-\s*(\d{3}))?\s*$/.exec(part);
    if (!m) return false;
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    return code >= lo && code <= hi;
  });

const TIMEOUT = Symbol("timeout");

const isSubrequestLimit = (e: unknown): boolean =>
  /too many subrequests/i.test((e as { message?: string } | null)?.message ?? "");

const classifyError = (e: unknown): ErrorClass => {
  const name = (e as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  if (e instanceof TypeError) return "connect";
  return "other";
};

// read up to BODY_CAP bytes, then cancel the stream
const readCapped = async (body: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < BODY_CAP) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(Math.min(size, BODY_CAP));
  let off = 0;
  for (const c of chunks) {
    if (off >= buf.length) break;
    const part = c.subarray(0, buf.length - off);
    buf.set(part, off);
    off += part.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
};

type Hop = { url: string; method: string; body: string | null };

// fetch semantics: 303 (and 301/302 after POST) continue as GET without a body
const nextHop = (hop: Hop, code: number, url: string): Hop =>
  code === 303 || ((code === 301 || code === 302) && hop.method === "POST")
    ? { url, method: hop.method === "HEAD" ? "HEAD" : "GET", body: null }
    : { ...hop, url };

/**
 * Null means "not run": no subrequest was available (or the runtime refused one),
 * so the check must be carried, not evaluated. Redirects are followed manually so
 * every hop is counted and re-checked against the SSRF guard.
 */
export const runHttpCheck = async (
  m: HttpMonitor,
  timeoutMs: number,
  take: TakeSubrequest = () => true,
): Promise<CheckResult | null> => {
  const fail = (error: ErrorClass, latencyMs: number | null, code: number | null): CheckResult => ({
    monitorId: m.id,
    ok: false,
    latencyMs,
    code,
    error,
  });

  // config errors (bad header, GET with body) surface here, before any subrequest
  let headers: Headers;
  try {
    headers = new Headers(m.headers);
    headers.set("User-Agent", USER_AGENT);
    new Request(m.url, { method: m.method, headers, body: m.body, redirect: "manual" });
  } catch {
    return fail("other", null, null);
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(TIMEOUT);
    }, timeoutMs);
  });

  const started = Date.now();
  try {
    let hop: Hop = { url: m.url, method: m.method, body: m.body };
    let res: Response;
    for (let redirects = 0; ; redirects++) {
      if (!take()) return null;
      const fetched = fetch(hop.url, {
        method: hop.method,
        headers,
        body: hop.body,
        redirect: "manual",
        signal: controller.signal,
      });
      fetched.catch(() => {}); // avoid unhandled rejection if the timeout wins
      const got = await Promise.race([fetched, timeout]);
      if (got === TIMEOUT) return fail("timeout", null, null);
      res = got;
      const location = res.headers.get("location");
      if (!m.followRedirects || !REDIRECT_CODES.has(res.status) || location === null) break;
      res.body?.cancel().catch(() => {});
      if (redirects >= MAX_REDIRECTS) return fail("other", null, res.status);
      let next: string;
      try {
        next = new URL(location, hop.url).toString();
        assertMonitorUrl(next);
      } catch {
        return fail("other", null, res.status);
      }
      hop = nextHop(hop, res.status, next);
    }

    const latencyMs = Date.now() - started;
    const code = res.status;

    if (!matchesStatus(code, m.expectedStatus)) {
      res.body?.cancel().catch(() => {});
      return fail("status", latencyMs, code);
    }
    if (m.keyword === null) {
      res.body?.cancel().catch(() => {});
      return { monitorId: m.id, ok: true, latencyMs, code, error: null };
    }

    const text = res.body ? await Promise.race([readCapped(res.body), timeout]) : "";
    if (text === TIMEOUT) return fail("timeout", latencyMs, code);

    const found = text.includes(m.keyword);
    const ok = m.keywordMode === "contains" ? found : !found;
    return ok
      ? { monitorId: m.id, ok: true, latencyMs, code, error: null }
      : fail("keyword", latencyMs, code);
  } catch (e) {
    if (isSubrequestLimit(e)) return null;
    return fail(classifyError(e), null, null);
  } finally {
    clearTimeout(timer);
  }
};
