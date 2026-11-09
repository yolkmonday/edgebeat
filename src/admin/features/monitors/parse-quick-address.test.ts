import { describe, expect, test } from "bun:test";
import { parseQuickAddress } from "./parse-quick-address";

const ok = (s: string) => {
  const r = parseQuickAddress(s);
  if (!r.ok) throw new Error(`expected ok for ${s}: ${r.error}`);
  return r.target;
};
const bad = (s: string) => {
  const r = parseQuickAddress(s);
  if (r.ok) throw new Error(`expected error for ${s}`);
  return r.error;
};

describe("parseQuickAddress", () => {
  test("bare host gets https", () => {
    expect(ok("example.com")).toEqual({ type: "http", url: "https://example.com", hostname: "example.com" });
  });
  test("host with path gets https", () => {
    expect(ok("example.com/health?x=1").type).toBe("http");
    expect(ok("example.com/health")).toMatchObject({ url: "https://example.com/health" });
  });
  test("explicit urls are kept and trimmed", () => {
    expect(ok("  http://example.com/a ")).toEqual({ type: "http", url: "http://example.com/a", hostname: "example.com" });
    expect(ok("HTTPS://httpbin.org/status/200")).toMatchObject({ type: "http", hostname: "httpbin.org" });
  });
  test("www is stripped from the hostname only", () => {
    expect(ok("www.example.com")).toEqual({ type: "http", url: "https://www.example.com", hostname: "example.com" });
  });
  test("host:port is tcp", () => {
    expect(ok("tcpbin.com:4242")).toEqual({ type: "tcp", host: "tcpbin.com", port: 4242, hostname: "tcpbin.com" });
    expect(ok("db.example.com:5432")).toMatchObject({ type: "tcp", port: 5432 });
    expect(ok("10.0.0.1:22")).toMatchObject({ type: "tcp", host: "10.0.0.1" });
  });
  test("ports 443 and 80 mean http", () => {
    expect(ok("example.com:443")).toMatchObject({ type: "http", url: "https://example.com" });
    expect(ok("example.com:80/x")).toMatchObject({ type: "http", url: "http://example.com/x" });
  });
  test("rejects empty and spaces", () => {
    expect(bad("")).toBeTruthy();
    expect(bad("   ")).toBeTruthy();
    expect(bad("exa mple.com")).toContain("spaces");
  });
  test("rejects invalid hosts", () => {
    expect(bad("-bad.com")).toContain("host");
    expect(bad("exa$mple.com")).toContain("host");
    expect(bad("a..b")).toContain("host");
    expect(bad("999.1.1.1")).toContain("host");
  });
  test("rejects bad ports", () => {
    expect(bad("example.com:0")).toContain("Port");
    expect(bad("example.com:65536")).toContain("Port");
    expect(bad("example.com:abc")).toContain("Port");
    expect(bad("example.com:")).toContain("Port");
  });
  test("rejects non-http schemes and bad urls", () => {
    expect(bad("ftp://example.com")).toContain("http");
    expect(bad("http://")).toBeTruthy();
  });
  test("custom port with path needs a scheme", () => {
    expect(bad("example.com:8080/x")).toContain("http");
  });
  test("ipv6 in brackets is rejected cleanly", () => {
    expect(bad("[::1]:22")).toContain("IPv6");
  });
});
