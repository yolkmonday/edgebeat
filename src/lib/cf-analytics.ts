import type { Env } from "@/env";

export type CfUsage = { d1Writes: number | null; requests: number | null };

const CACHE_OK_S = 300;
const CACHE_FAIL_S = 60;
const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

// d1AnalyticsAdaptiveGroups filters by `date_geq` (Date); the docs example is at
// https://developers.cloudflare.com/d1/observability/metrics-analytics/ (rowsWritten under `sum` is
// listed in its metrics table). workersInvocationsAdaptive filters by `datetime_geq` (Time).
const QUERY = `query Usage($account: String!, $day: Date!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workers: workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $from, datetime_lt: $to }) {
        sum { requests }
      }
      d1: d1AnalyticsAdaptiveGroups(limit: 1, filter: { date_geq: $day }) {
        sum { rowsWritten }
      }
    }
  }
}`;

type GraphqlBody = {
  data?: {
    viewer?: {
      accounts?: {
        workers?: { sum?: { requests?: unknown } }[] | null;
        d1?: { sum?: { rowsWritten?: unknown } }[] | null;
      }[];
    };
  } | null;
  errors?: unknown[] | null;
};

// an empty group list means "no traffic yet" (0); a missing list or a non-number means the field failed
const field = <T>(rows: T[] | null | undefined, pick: (r: T) => unknown): number | null => {
  if (!Array.isArray(rows)) return null;
  if (rows.length === 0) return 0;
  const v = pick(rows[0] as T);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export const parseUsage = (body: GraphqlBody): CfUsage | null => {
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) return null;
  const usage: CfUsage = {
    requests: field(account.workers, (r) => r.sum?.requests),
    d1Writes: field(account.d1, (r) => r.sum?.rowsWritten),
  };
  return usage.requests === null && usage.d1Writes === null ? null : usage;
};

type Cached = { failed: true } | { failed?: false; usage: CfUsage };

const isCached = (v: unknown): v is Cached => {
  if (typeof v !== "object" || v === null) return false;
  const c = v as { failed?: unknown; usage?: unknown };
  return c.failed === true || (typeof c.usage === "object" && c.usage !== null);
};

/**
 * Account-wide usage for the current UTC day. Null when unconfigured or when the query failed
 * (HTTP error, GraphQL errors with no usable field, bad shape); each field may be null on its own.
 * Successes are cached 300 s, failures 60 s.
 */
export const fetchUsage = async (env: Env, now: number): Promise<CfUsage | null> => {
  const account = env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN;
  if (!account || !token) return null;
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const day = startOfDay.toISOString().slice(0, 10);
  const key = new Request(`https://edgebeat.internal/usage/${encodeURIComponent(account)}/${day}`);
  const remember = (c: Cached, maxAge: number) =>
    caches.default
      .put(key, new Response(JSON.stringify(c), { headers: { "Cache-Control": `max-age=${maxAge}` } }))
      .catch(() => undefined);
  try {
    const hit = await caches.default.match(key);
    if (hit) {
      const cached: unknown = await hit.json();
      if (isCached(cached)) return cached.failed ? null : cached.usage;
    }
  } catch {
    // cache trouble: fall through to a live query
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: QUERY,
        variables: { account, day, from: startOfDay.toISOString(), to: new Date(now).toISOString() },
      }),
      signal: AbortSignal.timeout(5000),
    });
    const usage = res.ok ? parseUsage((await res.json()) as GraphqlBody) : null;
    await (usage ? remember({ usage }, CACHE_OK_S) : remember({ failed: true }, CACHE_FAIL_S));
    return usage;
  } catch {
    await remember({ failed: true }, CACHE_FAIL_S);
    return null;
  }
};
