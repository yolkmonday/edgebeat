import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const versionOf = (path: string): string =>
  (JSON.parse(readFileSync(resolve(import.meta.dir, path), "utf8")) as { version: string }).version;

// The CLI ships the release bundle built from the repo, so both must carry one version.
test("cli package version equals the root package version", () => {
  expect(versionOf("../package.json")).toBe(versionOf("../../package.json"));
});
