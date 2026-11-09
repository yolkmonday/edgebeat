// Minimal semver ordering for the code-downgrade guard (R18). No dependency on purpose.
type Parsed = { core: [number, number, number]; pre: string[] };

const parse = (v: string): Parsed | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
};

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

const compareIdentifiers = (a: string, b: string): number => {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return sign(Number(a) - Number(b));
  if (an !== bn) return an ? -1 : 1; // numeric identifiers sort before alphanumeric ones
  return a < b ? -1 : a > b ? 1 : 0;
};

// -1, 0 or 1 like a comparator; null when either side is not semver (callers then skip the check).
export const compareVersions = (a: string, b: string): number | null => {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    const d = sign(pa.core[i]! - pb.core[i]!);
    if (d !== 0) return d;
  }
  if (pa.pre.length === 0 || pb.pre.length === 0) return sign(pb.pre.length - pa.pre.length);
  for (let i = 0; i < Math.min(pa.pre.length, pb.pre.length); i++) {
    const d = compareIdentifiers(pa.pre[i]!, pb.pre[i]!);
    if (d !== 0) return d;
  }
  return sign(pa.pre.length - pb.pre.length);
};
