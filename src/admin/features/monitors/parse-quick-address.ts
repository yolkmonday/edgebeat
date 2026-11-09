export type QuickTarget =
  | { type: "http"; url: string; hostname: string }
  | { type: "tcp"; host: string; port: number; hostname: string };

export type QuickParse = { ok: true; target: QuickTarget } | { ok: false; error: string };

const fail = (error: string): QuickParse => ({ ok: false, error });

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const LABEL_RE = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/i;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

const isValidHost = (host: string): boolean => {
  if (host.length === 0 || host.length > 253) return false;
  if (IPV4_RE.test(host)) return host.split(".").every((o) => Number(o) <= 255);
  return host.split(".").every((label) => LABEL_RE.test(label));
};

const stripWww = (host: string): string => host.replace(/^www\./i, "");

/** Turns what a person types into a monitor target. Only basic shape checks; the server's url-guard does the rest. */
export const parseQuickAddress = (input: string): QuickParse => {
  const raw = input.trim();
  if (raw === "") return fail("Enter an address");
  if (/\s/.test(raw)) return fail("Addresses can't contain spaces");

  if (SCHEME_RE.test(raw)) {
    if (!/^https?:\/\//i.test(raw)) return fail("Only http:// and https:// URLs are supported");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return fail("That doesn't look like a valid URL");
    }
    if (url.hostname === "") return fail("That URL has no host");
    return { ok: true, target: { type: "http", url: raw, hostname: stripWww(url.hostname) } };
  }

  if (raw.startsWith("[")) return fail("IPv6 addresses aren't supported here. Use the full form.");

  const match = /^([^/:?#]+)(?::([^/?#]*))?([/?#].*)?$/.exec(raw);
  if (!match) return fail("That doesn't look like a valid address");
  const host = match[1] ?? "";
  const portText = match[2];
  const rest = match[3] ?? "";
  if (!isValidHost(host)) return fail("That doesn't look like a valid host name");

  if (portText === undefined) {
    return { ok: true, target: { type: "http", url: `https://${raw}`, hostname: stripWww(host.toLowerCase()) } };
  }
  if (!/^\d+$/.test(portText)) return fail("Port must be a number from 1 to 65535");
  const port = Number(portText);
  if (port < 1 || port > 65_535) return fail("Port must be a number from 1 to 65535");

  const hostname = stripWww(host.toLowerCase());
  if (port === 443) return { ok: true, target: { type: "http", url: `https://${host}${rest}`, hostname } };
  if (port === 80) return { ok: true, target: { type: "http", url: `http://${host}${rest}`, hostname } };
  if (rest !== "") return fail("To check a URL on a custom port, start with http:// or https://");
  return { ok: true, target: { type: "tcp", host, port, hostname } };
};
