import { describe, expect, test } from "bun:test";
import { parseArgs } from "./args";

describe("parseArgs", () => {
  test("parses all flags", () => {
    const r = parseArgs([
      "setup",
      "--api-token",
      "tok",
      "--account=acc1",
      "--name",
      "mon",
      "--admin-password",
      "a-strong-password-1",
      "--subdomain",
      "me",
      "--yes",
    ]);
    expect(r).toEqual({
      ok: true,
      args: {
        command: "setup",
        apiToken: "tok",
        account: "acc1",
        name: "mon",
        adminPassword: "a-strong-password-1",
        subdomain: "me",
        yes: true,
      },
    });
  });

  test("defaults name to upflare and command to help", () => {
    const r = parseArgs([]);
    expect(r.ok && r.args.name).toBe("upflare");
    expect(r.ok && r.args.command).toBe("help");
  });

  test("--version selects the version command", () => {
    const r = parseArgs(["--version"]);
    expect(r.ok && r.args.command).toBe("version");
  });

  test("unknown flag is a usage error listing valid flags", () => {
    const r = parseArgs(["setup", "--bogus"]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("--bogus");
    expect(r.error).toContain("--api-token");
    expect(r.error).toContain("--yes");
  });

  test("unknown command and missing value are usage errors", () => {
    expect(parseArgs(["deploy"]).ok).toBe(false);
    expect(parseArgs(["setup", "--name"]).ok).toBe(false);
  });
});
