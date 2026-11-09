#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { loadBundle } from "./bundle/load";
import { createCloudflareApi } from "./cf/api";
import { createIo } from "./cli/prompt";
import { run } from "./cli/run";
import { install, update, validateAdminPassword, validateName } from "./installer";

// Works from src/bin.ts and dist/bin.js: both sit one level below the package root.
const packageUrl = (path: string): URL => new URL(`../${path}`, import.meta.url);

const readVersion = (): string => {
  try {
    const pkg = JSON.parse(readFileSync(packageUrl("package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
};

const code = await run(process.argv.slice(2), {
  api: (token) => createCloudflareApi(token),
  bundle: () => loadBundle(fileURLToPath(packageUrl("bundle"))),
  io: createIo(),
  installer: { install, update, validateAdminPassword, validateName },
  version: readVersion(),
});
process.exit(code);
