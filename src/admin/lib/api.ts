import type { ApiErrorBody, Issue } from "@shared/admin-api";

export type ApiError = Error & { status: number; code: string; issues: Issue[]; body: ApiErrorBody | null };

const BASE = "/api/admin";

export const makeApiError = (status: number, body: ApiErrorBody | null): ApiError =>
  Object.assign(new Error(body?.error ?? `http_${status}`), {
    name: "ApiError",
    status,
    code: body?.error ?? (status === 0 ? "network" : `http_${status}`),
    issues: body?.issues ?? [],
    body,
  });

export const isApiError = (e: unknown): e is ApiError =>
  e instanceof Error && e.name === "ApiError" && typeof (e as ApiError).status === "number";

let onUnauthorized: () => void = () => {};

/** Called on any 401 except the one from `/login`. */
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

const readBody = async (res: Response): Promise<ApiErrorBody | null> => {
  try {
    const v: unknown = await res.json();
    return v && typeof v === "object" ? (v as ApiErrorBody) : null;
  } catch {
    return null;
  }
};

const send = async (method: string, path: string, body?: unknown): Promise<Response> => {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw makeApiError(0, { error: "network" });
  }
  if (res.ok) return res;
  const err = makeApiError(res.status, await readBody(res));
  if (res.status === 401 && !path.startsWith("/login")) onUnauthorized();
  throw err;
};

const json = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await send(method, path, body);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
};

export const api = {
  get: <T>(path: string) => json<T>("GET", path),
  post: <T>(path: string, body?: unknown) => json<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => json<T>("PATCH", path, body),
  del: (path: string) => json<void>("DELETE", path),
  download: async (path: string): Promise<Blob> => (await send("GET", path)).blob(),
};

/** Maps an API error to `{ fieldPath: message }` for form fields. */
export const fieldErrors = (e: ApiError): Record<string, string> => {
  if (e.code === "invalid_url") return { url: "Private addresses like 10.0.0.1 aren't allowed. Use a public hostname." };
  if (e.code === "slug_conflict") return { slug: "Another monitor already uses this slug." };
  return Object.fromEntries(e.issues.map((i) => [i.path.join("."), i.message]));
};
