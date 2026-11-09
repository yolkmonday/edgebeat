import { describe, expect, test } from "bun:test";
import { isInstallError } from "../contracts";
import { generateEncryptionKey, generatePassword, validateAdminPassword, validateName } from "./secrets";

const failure = (fn: () => void): { code: string; message: string } | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return isInstallError(e) ? { code: e.code, message: e.message } : { code: "not_install_error", message: "" };
  }
};

describe("secrets", () => {
  test("generateEncryptionKey decodes to 32 bytes of standard base64", () => {
    const key = generateEncryptionKey();
    expect(key).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(atob(key).length).toBe(32);
    expect(generateEncryptionKey()).not.toBe(key);
  });

  test("generatePassword is 24 alphanumeric chars and differs per call", () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(b).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(a).not.toBe(b);
  });

  test("generatePassword covers the whole alphabet", () => {
    const seen = new Set(Array.from({ length: 200 }, generatePassword).join(""));
    expect(seen.size).toBe(62);
  });

  test("validateAdminPassword enforces length >= 12 and not change-me", () => {
    const copy = 'Admin password must be at least 12 characters and not "change-me".';
    expect(failure(() => validateAdminPassword("change-me"))).toEqual({ code: "weak_password", message: copy });
    expect(failure(() => validateAdminPassword("elevenchars"))?.code).toBe("weak_password");
    expect(failure(() => validateAdminPassword("twelve-chars"))).toBeNull();
  });

  test("validateName follows the slug rule", () => {
    expect(failure(() => validateName("edgebeat"))).toBeNull();
    expect(failure(() => validateName("my-status-2"))).toBeNull();
    expect(failure(() => validateName("a".repeat(63)))).toBeNull();
    expect(failure(() => validateName(""))?.code).toBe("invalid_name");
    expect(failure(() => validateName("a".repeat(64)))?.code).toBe("invalid_name");
    expect(failure(() => validateName("Edgebeat"))?.code).toBe("invalid_name");
    expect(failure(() => validateName("edge_beat"))?.code).toBe("invalid_name");
  });
});
