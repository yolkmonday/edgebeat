import { describe, expect, test } from "bun:test";
import { groupFormSchema, slugify } from "./group-form";

describe("slugify", () => {
  test("lowercases and dashes", () => expect(slugify("  Core Services! ")).toBe("core-services"));
  test("strips accents", () => expect(slugify("Café API")).toBe("cafe-api"));
  test("caps at 64 chars without a trailing dash", () => {
    const slug = slugify(`${"a".repeat(63)} b`);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("groupFormSchema", () => {
  test("accepts a valid group", () => expect(groupFormSchema.safeParse({ name: "Core", slug: "core" }).success).toBe(true));
  test("rejects a bad slug", () => expect(groupFormSchema.safeParse({ name: "Core", slug: "Core Services" }).success).toBe(false));
});
