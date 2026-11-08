const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// 26-char ULID-like id: 48-bit ms timestamp (10 chars) + 80 random bits (16 chars)
export const newId = (): string => {
  let time = Date.now();
  let head = "";
  for (let i = 0; i < 10; i++) {
    head = ALPHABET[time % 32]! + head;
    time = Math.floor(time / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(10));
  let bits = 0n;
  for (const b of rand) bits = (bits << 8n) | BigInt(b);
  let tail = "";
  for (let i = 0; i < 16; i++) {
    tail = ALPHABET[Number(bits & 31n)]! + tail;
    bits >>= 5n;
  }
  return head + tail;
};

// 128-bit random token, base64url without padding (22 chars)
export const newToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};
