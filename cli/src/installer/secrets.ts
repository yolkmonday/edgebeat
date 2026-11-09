import { makeInstallError } from "../contracts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const PASSWORD_LENGTH = 24;
// Largest multiple of 62 that fits in a byte; bytes at or above it are rejected (no modulo bias).
const BYTE_LIMIT = 256 - (256 % ALPHABET.length);

export const WEAK_PASSWORD_MESSAGE = 'Admin password must be at least 12 characters and not "change-me".';
const NAME_RULE = /^[a-z0-9-]{1,63}$/;

export const validateAdminPassword = (p: string): void => {
  if (p.length >= 12 && p !== "change-me") return;
  throw makeInstallError("weak_password", WEAK_PASSWORD_MESSAGE);
};

export const isValidSlug = (s: string): boolean => NAME_RULE.test(s);

export const validateName = (n: string): void => {
  if (isValidSlug(n)) return;
  throw makeInstallError("invalid_name", "Name must be 1 to 63 characters of lowercase letters, digits and hyphens.");
};

export const generatePassword = (): string => {
  const out: string[] = [];
  while (out.length < PASSWORD_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b >= BYTE_LIMIT) continue;
      out.push(ALPHABET[b % ALPHABET.length] ?? "");
      if (out.length === PASSWORD_LENGTH) break;
    }
  }
  return out.join("");
};

export const generateEncryptionKey = (): string =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
