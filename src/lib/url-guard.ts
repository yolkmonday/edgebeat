const invalid = () => new Error("invalid_url");

const inV4 = (o: number[], a: number, b: number, mask: number) =>
  o[0] === a && (b < 0 || (o[1]! & mask) === b);

const isBlockedV4 = (o: number[]): boolean =>
  o[0] === 0 ||
  inV4(o, 10, -1, 0) ||
  inV4(o, 127, -1, 0) ||
  inV4(o, 169, 254, 0xff) ||
  inV4(o, 172, 16, 0xf0) ||
  inV4(o, 192, 168, 0xff) ||
  inV4(o, 100, 64, 0xc0);

const parseV4 = (host: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return m ? m.slice(1).map(Number) : null;
};

// expand an IPv6 literal (without brackets) into 8 16-bit groups
const parseV6 = (host: string): number[] | null => {
  const parts = host.split("::");
  if (parts.length > 2) return null;
  const toGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(parts[0]!);
  const tail = parts.length === 2 ? toGroups(parts[1]!) : [];
  if (!head || !tail) return null;
  if (parts.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
};

const isBlockedV6 = (g: number[]): boolean => {
  if (g.slice(0, 7).every((x) => x === 0) && (g[7] === 1 || g[7] === 0)) return true; // ::1, ::
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10
  // IPv4-mapped ::ffff:a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return isBlockedV4([g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff]);
  }
  return false;
};

/** Throws Error('invalid_url') unless url is a public http(s) URL. */
export const assertMonitorUrl = (url: string): void => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw invalid();
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw invalid();

  // URL already normalizes decimal/hex/octal IPv4 forms to dotted quad
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) throw invalid();

  if (host.startsWith("[") && host.endsWith("]")) {
    const g = parseV6(host.slice(1, -1));
    if (!g || isBlockedV6(g)) throw invalid();
    return;
  }
  const v4 = parseV4(host);
  if (v4 && isBlockedV4(v4)) throw invalid();
};
