import { describe, expect, test } from "bun:test";
import { compareVersions } from "./semver";

describe("compareVersions", () => {
  test("orders by numeric core, not text", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
  });

  test("a prerelease sorts before its release; identifiers compare per semver", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    expect(compareVersions("1.0.0+build.5", "1.0.0")).toBe(0);
  });

  test("unparseable versions compare as null", () => {
    expect(compareVersions("dev", "1.0.0")).toBeNull();
    expect(compareVersions("1.0", "1.0.0")).toBeNull();
  });
});
