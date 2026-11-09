import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReleaseBundle, ReleaseManifest } from "../contracts";

const walk = async (dir: string, prefix = ""): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : Promise.resolve([`${prefix}${e.name}`]),
    ),
  );
  return nested.flat().sort();
};

const bytes = async (path: string): Promise<Uint8Array> => new Uint8Array(await readFile(path));

export const loadBundle = async (dir: string): Promise<ReleaseBundle> => {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as ReleaseManifest;

  const modules: Record<string, Uint8Array> = {};
  for (const { name } of manifest.modules) modules[name] = await bytes(join(dir, "worker", name));

  const assets: Record<string, Uint8Array> = {};
  for (const rel of await walk(join(dir, "assets"))) assets[`/${rel}`] = await bytes(join(dir, "assets", rel));

  const migrations: { name: string; sql: string }[] = [];
  for (const name of manifest.migrations) {
    migrations.push({ name, sql: await readFile(join(dir, "migrations", name), "utf8") });
  }
  return { manifest, modules, assets, migrations };
};
