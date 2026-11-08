import { describe, expect, it } from "bun:test";
import { assertMonitorUrl } from "@/lib/url-guard";
import { matchesStatus } from "@/checks/http";

describe("assertMonitorUrl", () => {
  it("accepts public http(s) urls", () => {
    expect(() => assertMonitorUrl("https://kirimi.id/health")).not.toThrow();
    expect(() => assertMonitorUrl("http://172.32.0.1/")).not.toThrow();
    expect(() => assertMonitorUrl("http://[2606:4700::1]/")).not.toThrow();
  });
  it.each([
    "ftp://x",
    "not a url",
    "http://localhost",
    "http://LOCALHOST./",
    "http://foo.localhost/",
    "http://0.0.0.0/",
    "http://10.1.2.3",
    "http://127.0.0.1/",
    "http://169.254.169.254/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://100.64.0.1/",
    "http://100.127.255.255/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fd12::1]/",
    "http://[fe80::1]/",
    "http://[febf::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://0177.0.0.1/",
  ])("rejects %s", (url) => {
    expect(() => assertMonitorUrl(url)).toThrow("invalid_url");
  });
});

describe("matchesStatus", () => {
  it("matches ranges and lists", () => {
    expect(matchesStatus(204, "200-299")).toBe(true);
    expect(matchesStatus(404, "200-399")).toBe(false);
    expect(matchesStatus(302, "200,301-302")).toBe(true);
    expect(matchesStatus(204, "200,301-302")).toBe(false);
    expect(matchesStatus(200, " 200 , 204 ")).toBe(true);
    expect(matchesStatus(200, "garbage")).toBe(false);
  });
});
