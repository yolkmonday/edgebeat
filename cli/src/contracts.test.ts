import { describe, expect, test } from "bun:test";
import { isInstallError, makeInstallError } from "./contracts";

describe("install error", () => {
  test("makeInstallError builds an error recognised by isInstallError", () => {
    const message = "Admin password must be at least 12 characters and not \"change-me\".";
    const e = makeInstallError("weak_password", message);
    expect(e).toBeInstanceOf(Error);
    expect(isInstallError(e)).toBe(true);
    expect(e.code).toBe("weak_password");
    expect(e.message).toBe(message);
  });

  test("plain Error and non-errors are not install errors", () => {
    expect(isInstallError(new Error("x"))).toBe(false);
    expect(isInstallError({ code: "api_error", message: "x" })).toBe(false);
    expect(isInstallError(null)).toBe(false);
  });
});
