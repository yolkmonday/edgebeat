import { makeInstallError } from "../contracts";
import type { HttpClient } from "./http";

const toBase64 = (bytes: Uint8Array): string => {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
};

const extensionOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1);
};

// First 32 hex chars of SHA-256 over base64(contents) + extension (no dot), as wrangler does.
export const assetHash = async (path: string, bytes: Uint8Array): Promise<string> => {
  const data = new TextEncoder().encode(toBase64(bytes) + extensionOf(path));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
};

const MIME: Record<string, string> = {
  html: "text/html", css: "text/css", js: "application/javascript", mjs: "application/javascript",
  json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", txt: "text/plain",
  woff: "font/woff", woff2: "font/woff2", map: "application/json", webmanifest: "application/manifest+json",
};

type Session = { jwt: string; buckets?: string[][] };

export const uploadAssetFiles = async (
  http: HttpClient,
  accountId: string,
  scriptName: string,
  assets: Record<string, Uint8Array>,
): Promise<string> => {
  const manifest: Record<string, { hash: string; size: number }> = {};
  const byHash = new Map<string, { path: string; bytes: Uint8Array }>();
  for (const [path, bytes] of Object.entries(assets)) {
    const hash = await assetHash(path, bytes);
    manifest[path] = { hash, size: bytes.length };
    byHash.set(hash, { path, bytes });
  }
  const session = await http.json<Session>(
    "POST",
    `/accounts/${accountId}/workers/scripts/${scriptName}/assets-upload-session`,
    { manifest },
  );
  const buckets = session.buckets ?? [];
  if (buckets.length === 0) return session.jwt;

  let completion: string | undefined;
  for (const bucket of buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const file = byHash.get(hash);
      if (!file) continue;
      const type = MIME[extensionOf(file.path).toLowerCase()] ?? "application/octet-stream";
      form.append(hash, new Blob([toBase64(file.bytes)], { type }), hash);
    }
    const path = `/accounts/${accountId}/workers/assets/upload?base64=true`;
    const res = await http.raw("POST", path, { token: session.jwt, body: form, upload: true });
    const result = await http.parse<{ jwt?: string } | null>(res, "POST", path);
    if (result?.jwt) completion = result.jwt;
  }
  if (!completion) {
    throw makeInstallError("api_error", "Cloudflare did not return an asset completion token after upload.");
  }
  return completion;
};
