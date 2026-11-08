import type { CheckResult, ErrorClass, KeywordMode } from "@/core/types";

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

const BODY_CAP = 65_536;
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

export const runHttpCheck = async (m: HttpMonitor, timeoutMs: number): Promise<CheckResult> => {
  const fail = (error: ErrorClass, latencyMs: number | null, code: number | null): CheckResult => ({
    monitorId: m.id,
    ok: false,
    latencyMs,
    code,
    error,
  });

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
    const headers = new Headers(m.headers);
    headers.set("User-Agent", USER_AGENT);
    const fetched = fetch(m.url, {
      method: m.method,
      headers,
      body: m.body,
      redirect: m.followRedirects ? "follow" : "manual",
      signal: controller.signal,
    });
    fetched.catch(() => {}); // avoid unhandled rejection if the timeout wins
    const res = await Promise.race([fetched, timeout]);
    if (res === TIMEOUT) return fail("timeout", null, null);

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
    return fail(classifyError(e), null, null);
  } finally {
    clearTimeout(timer);
  }
};
