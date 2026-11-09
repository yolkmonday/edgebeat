const TOKEN_RE = /^eb_[A-Za-z0-9_-]{43}$/;
const PREFIX_LENGTH = 10;

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** `eb_` + 32 random bytes base64url (46 chars). Shown to the user once, never stored. */
export const newApiToken = (): string => `eb_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;

/** Hex SHA-256: tokens carry 256 bits of entropy, so a fast hash is enough (no salt or stretching needed). */
export const hashToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const tokenPrefix = (token: string): string => token.slice(0, PREFIX_LENGTH);

export const looksLikeToken = (token: string): boolean => TOKEN_RE.test(token);
