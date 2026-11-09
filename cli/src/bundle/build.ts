import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReleaseManifest } from "../contracts";

// Remove // and /* */ comments and trailing commas, leaving string contents untouched.
export const stripJsonc = (src: string): string => {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return removeTrailingCommas(out);
};

// String-aware trailing comma removal (a comma followed only by whitespace and a closer).
const removeTrailingCommas = (src: string): string => {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === ",") {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j]!)) j++;
      if (src[j] !== "}" && src[j] !== "]") out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
};

const contentTypeFor = (name: string): string => {
  if (name.endsWith(".js") || name.endsWith(".mjs")) return "application/javascript+module";
  if (name.endsWith(".map")) return "application/source-map";
  return "application/octet-stream";
};

const run = (cmd: string, args: string[], cwd: string): Promise<void> =>
  new Promise((done, fail) => {
    execFile(cmd, args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return fail(new Error(`${cmd} ${args.join(" ")} failed: ${err.message}\n${stdout}\n${stderr}`));
      done();
    });
  });

const listFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();
};

type WranglerConfig = {
  compatibility_date?: string;
  compatibility_flags?: string[];
  triggers?: { crons?: string[] };
  assets?: { run_worker_first?: string[]; html_handling?: string; not_found_handling?: string };
  observability?: { enabled?: boolean };
};

export const buildBundle = async (repoRoot: string, outDir: string): Promise<ReleaseManifest> => {
  const root = resolve(repoRoot);
  const out = resolve(outDir);
  const bin = (name: string) => join(root, "node_modules", ".bin", name);

  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
  const config = JSON.parse(stripJsonc(await readFile(join(root, "wrangler.jsonc"), "utf8"))) as WranglerConfig;
  if (!config.compatibility_date) throw new Error("wrangler.jsonc has no compatibility_date");

  await run(bin("vite"), ["build"], root);

  const tmp = await mkdtemp(join(tmpdir(), "edgebeat-bundle-"));
  try {
    // Bundling only: --dry-run needs no auth and makes no network calls.
    await run(bin("wrangler"), ["deploy", "--dry-run", "--outdir", tmp], root);

    await rm(out, { recursive: true, force: true });
    await mkdir(join(out, "worker"), { recursive: true });

    const files = (await listFiles(tmp)).filter((n) => /\.(m?js|map)$/.test(n));
    const mainModule = files.find((n) => n === "index.js") ?? files.find((n) => /\.m?js$/.test(n));
    if (!mainModule) throw new Error("wrangler dry-run produced no worker module");
    for (const name of files) await cp(join(tmp, name), join(out, "worker", name));

    await cp(join(root, "dist", "status-page"), join(out, "assets"), { recursive: true });

    await mkdir(join(out, "migrations"), { recursive: true });
    const migrations = (await listFiles(join(root, "migrations"))).filter((n) => n.endsWith(".sql"));
    for (const name of migrations) await cp(join(root, "migrations", name), join(out, "migrations", name));

    const assets = config.assets ?? {};
    const manifest: ReleaseManifest = {
      version: pkg.version,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags ?? [],
      mainModule,
      modules: files.map((name) => ({ name, contentType: contentTypeFor(name) })),
      crons: config.triggers?.crons ?? [],
      assetsConfig: {
        run_worker_first: assets.run_worker_first ?? [],
        ...(assets.html_handling ? { html_handling: assets.html_handling } : {}),
        ...(assets.not_found_handling ? { not_found_handling: assets.not_found_handling } : {}),
      },
      migrations,
      observability: config.observability?.enabled ?? false,
    };
    await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
};

if (import.meta.main) {
  const cliDir = fileURLToPath(new URL("../..", import.meta.url));
  const manifest = await buildBundle(resolve(cliDir, ".."), join(cliDir, "bundle"));
  console.log(`bundle ${manifest.version}: ${manifest.modules.length} modules, ${manifest.migrations.length} migrations`);
}
