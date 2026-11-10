import type { Env } from "@/env";

const decodeKey = (b64: string | undefined): Uint8Array<ArrayBuffer> => {
  if (!b64) throw new Error("bad_encryption_key");
  let raw: string;
  try {
    raw = atob(b64.trim());
  } catch {
    throw new Error("bad_encryption_key");
  }
  const bytes = Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
  if (bytes.length < 32) throw new Error("bad_encryption_key");
  return bytes;
};

const derive = async (env: Env, info: string, usages: ("sign" | "verify")[]): Promise<CryptoKey> => {
  const ikm = await crypto.subtle.importKey("raw", decodeKey(env.ENCRYPTION_KEY), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(info),
    },
    ikm,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    usages,
  );
};

/** HMAC-SHA256 key for session JWTs. Throws Error('bad_encryption_key') when ENCRYPTION_KEY is unusable. */
export const jwtKey = (env: Env): Promise<CryptoKey> => derive(env, "upflare-jwt", ["sign", "verify"]);
