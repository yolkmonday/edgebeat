import type { Env } from "@/env";

export type CfUsage = { d1Writes: number; requests: number };

const CACHE_S = 300;
const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

// field names follow the Cloudflare GraphQL Analytics schema; unverified against a live account
const QUERY = `query Usage($account: String!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      workers: workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $from, datetime_lt: $to }) {
        sum { requests }
      }
      d1: d1AnalyticsAdaptiveGroups(limit: 1, filter: { datetime_geq: $from, datetime_lt: $to }) {
        sum { rowsWritten }
      }
    }
  }
}`;

type GraphqlBody = {
  data?: {
    viewer?: {
      accounts?: {
        workers?: { sum?: { requests?: number } }[];
        d1?: { sum?: { rowsWritten?: number } }[];
      }[];
    };
  };
};

const parseUsage = (body: GraphqlBody): CfUsage | null => {
  const account = body.data?.viewer?.accounts?.[0];
  if (!account) return null;
  const requests = account.workers?.[0]?.sum?.requests ?? 0;
  const d1Writes = account.d1?.[0]?.sum?.rowsWritten ?? 0;
  if (typeof requests !== "number" || typeof d1Writes !== "number") return null;
  return { d1Writes, requests };
};

const isUsage = (v: unknown): v is CfUsage =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as CfUsage).d1Writes === "number" &&
  typeof (v as CfUsage).requests === "number";

/** Account-wide usage for the current UTC day; null when unconfigured or on any error. Cached 300 s. */
export const fetchUsage = async (env: Env, now: number): Promise<CfUsage | null> => {
  const account = env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN;
  if (!account || !token) return null;
  try {
    const from = new Date(now);
    from.setUTCHours(0, 0, 0, 0);
    const day = from.toISOString().slice(0, 10);
    const key = new Request(`https://edgebeat.internal/usage/${encodeURIComponent(account)}/${day}`);
    const hit = await caches.default.match(key);
    if (hit) {
      const cached: unknown = await hit.json();
      if (isUsage(cached)) return cached;
    }
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: QUERY,
        variables: { account, from: from.toISOString(), to: new Date(now).toISOString() },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const usage = parseUsage((await res.json()) as GraphqlBody);
    if (!usage) return null;
    await caches.default.put(
      key,
      new Response(JSON.stringify(usage), { headers: { "Cache-Control": `max-age=${CACHE_S}` } }),
    );
    return usage;
  } catch {
    return null;
  }
};
