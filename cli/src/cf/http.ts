import { makeInstallError, type InstallErrorCode } from "../contracts";

export type FetchLike = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
export type HttpClient = {
  json: <T>(method: string, path: string, body?: unknown) => Promise<T>;
  form: <T>(method: string, path: string, form: FormData) => Promise<T>;
  raw: (method: string, path: string, init: { token?: string; body?: BodyInit; upload?: boolean }) => Promise<Response>;
  parse: <T>(res: Response, method: string, path: string) => Promise<T>;
  page: <T>(path: string) => Promise<{ result: T; page?: number; totalPages?: number }>;
};
export type Timeouts = { request?: number; upload?: number; health?: number };

type CfError = { code?: number; message?: string };
type Envelope<T> = {
  success?: boolean;
  errors?: CfError[];
  result?: T;
  result_info?: { page?: number; total_pages?: number };
};

export type CfFailure = { status: number; errors: CfError[]; path: string; method: string };

const permissionFor = (path: string): string => {
  if (path.includes("/d1/")) return "Account · D1 · Edit";
  if (path.includes("/workers/")) return "Account · Workers Scripts · Edit";
  return "Account · Account Settings · Read";
};

export const mapFailure = (f: CfFailure): Error & { code: InstallErrorCode } => {
  const message = f.errors.map((e) => e.message ?? "").filter(Boolean).join("; ") || `HTTP ${f.status}`;
  const codes = f.errors.map((e) => e.code);
  const isD1Create = f.method === "POST" && /\/d1\/database(\?.*)?$/.test(f.path);
  const isSchedules = f.path.endsWith("/schedules");
  const limitWords = /limit|maximum|quota|exceed|too many/i;
  if (f.status === 403 && f.path.includes("/workers/assets/upload")) {
    return makeInstallError("api_error", "Asset upload session expired, re-run setup");
  }
  if (f.status === 403 || codes.includes(10000)) {
    return makeInstallError(
      "missing_permission",
      `The API token is missing a permission: ${permissionFor(f.path)}. Edit the token and add it.`,
    );
  }
  if (isD1Create && limitWords.test(message)) {
    return makeInstallError("limit_d1", `D1 database limit reached on this account: ${message}`);
  }
  if (isSchedules && /cron|trigger|schedule/i.test(message) && limitWords.test(message)) {
    return makeInstallError("limit_cron", `Cron trigger limit reached on this account: ${message}`);
  }
  return makeInstallError("api_error", `Cloudflare API error (${f.status}): ${message}`);
};

export const isNotFound = (e: unknown): boolean => (e as { status?: number } | null)?.status === 404;

export const createHttp = (
  token: string,
  baseUrl: string,
  fetchImpl: FetchLike,
  timeouts: Timeouts = {},
): HttpClient => {
  const safe = (s: string): string => (token ? s.split(token).join("[redacted]") : s);

  const send = async (method: string, path: string, init: RequestInit, upload = false): Promise<Response> => {
    const ms = upload ? (timeouts.upload ?? 120_000) : (timeouts.request ?? 30_000);
    try {
      return await fetchImpl(`${baseUrl}${path}`, { ...init, method, signal: AbortSignal.timeout(ms) });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        throw makeInstallError("api_error", "Cloudflare API timed out");
      }
      throw makeInstallError(
        "api_error",
        safe(`Network error calling Cloudflare: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  };

  const parseEnv = async <T>(res: Response, method: string, path: string): Promise<Envelope<T>> => {
    const text = await res.text();
    let env: Envelope<T> | null = null;
    try {
      env = JSON.parse(text) as Envelope<T>;
    } catch {
      env = null;
    }
    if (!res.ok || !env || env.success === false) {
      const err = mapFailure({ status: res.status, errors: env?.errors ?? [], path, method });
      err.message = safe(err.message);
      throw Object.assign(err, { status: res.status });
    }
    return env;
  };
  const parse = async <T>(res: Response, method: string, path: string): Promise<T> =>
    (await parseEnv<T>(res, method, path)).result as T;

  const auth = { Authorization: `Bearer ${token}` };
  return {
    json: async (method, path, body) => {
      const res = await send(method, path, {
        headers: { ...auth, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return parse(res, method, path);
    },
    form: async (method, path, form) =>
      parse(await send(method, path, { headers: auth, body: form }, true), method, path),
    raw: (method, path, init) =>
      send(method, path, { headers: { Authorization: `Bearer ${init.token ?? token}` }, body: init.body }, init.upload),
    parse,
    page: async <T>(path: string) => {
      const env = await parseEnv<T>(await send("GET", path, { headers: auth }), "GET", path);
      return { result: env.result as T, page: env.result_info?.page, totalPages: env.result_info?.total_pages };
    },
  };
};
