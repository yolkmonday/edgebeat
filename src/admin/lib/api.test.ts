import { afterEach, describe, expect, test } from "bun:test";
import { api, fieldErrors, isApiError, makeApiError, setUnauthorizedHandler, type ApiError } from "./api";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setUnauthorizedHandler(() => {});
});

const mockFetch = (res: Response | (() => never)) => {
  globalThis.fetch = (async () => (typeof res === "function" ? res() : res)) as unknown as typeof fetch;
};
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const caught = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
  } catch (e) {
    if (isApiError(e)) return e;
    throw e;
  }
  throw new Error("expected rejection");
};

describe("api client", () => {
  test("204 resolves undefined", async () => {
    mockFetch(new Response(null, { status: 204 }));
    expect(await api.del("/monitors/x")).toBeUndefined();
  });
  test("200 parses json", async () => {
    mockFetch(jsonRes(200, { a: 1 }));
    expect(await api.get<{ a: number }>("/x")).toEqual({ a: 1 });
  });
  test("400 with issues throws ApiError", async () => {
    const issues = [{ path: ["url"], message: "bad" }];
    mockFetch(jsonRes(400, { error: "validation", issues }));
    const e = await caught(api.post("/monitors", {}));
    expect(e.status).toBe(400);
    expect(e.code).toBe("validation");
    expect(e.issues).toEqual(issues);
  });
  test("401 calls the unauthorized handler except on /login", async () => {
    let calls = 0;
    setUnauthorizedHandler(() => void calls++);
    mockFetch(jsonRes(401, { error: "unauthorized" }));
    await caught(api.get("/monitors"));
    expect(calls).toBe(1);
    await caught(api.post("/login", { password: "x" }));
    expect(calls).toBe(1);
  });
  test("401 from /session never calls the unauthorized handler (session guards handle it)", async () => {
    let calls = 0;
    setUnauthorizedHandler(() => void calls++);
    mockFetch(jsonRes(401, { error: "unauthorized" }));
    await caught(api.get("/session"));
    expect(calls).toBe(0);
  });
  test("setUnauthorizedHandler returns a restore for the previous handler", async () => {
    const seen: string[] = [];
    setUnauthorizedHandler(() => void seen.push("default"));
    const restore = setUnauthorizedHandler(() => void seen.push("layout"));
    mockFetch(jsonRes(401, { error: "unauthorized" }));
    await caught(api.get("/monitors"));
    restore();
    await caught(api.get("/monitors"));
    expect(seen).toEqual(["layout", "default"]);
  });
  test("network failure maps to code network", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });
    const e = await caught(api.get("/x"));
    expect(e.status).toBe(0);
    expect(e.code).toBe("network");
  });
  test("non-json error body still yields ApiError", async () => {
    mockFetch(new Response("boom", { status: 502 }));
    const e = await caught(api.get("/x"));
    expect(e.status).toBe(502);
    expect(e.body).toBeNull();
  });
});

describe("fieldErrors", () => {
  test("invalid_url", () => {
    expect(fieldErrors(makeApiError(400, { error: "invalid_url" }))).toEqual({
      url: "Private addresses like 10.0.0.1 aren't allowed. Use a public hostname.",
    });
  });
  test("slug_conflict", () => {
    expect(fieldErrors(makeApiError(409, { error: "slug_conflict" }))).toEqual({
      slug: "Another monitor already uses this slug.",
    });
  });
  test("nested issue paths join with dots", () => {
    const e = makeApiError(400, {
      error: "validation",
      issues: [
        { path: ["headers", "X-Key"], message: "bad header" },
        { path: ["port"], message: "required" },
      ],
    });
    expect(fieldErrors(e)).toEqual({ "headers.X-Key": "bad header", port: "required" });
  });
});
