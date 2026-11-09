import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { VERSION } from "@/version";

describe("version", () => {
  it("matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });
});
