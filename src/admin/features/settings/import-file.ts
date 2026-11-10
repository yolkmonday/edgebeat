import type { ExportFile } from "@shared/admin-api";

export type ParsedImport = { ok: true; file: ExportFile } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Cheap structural check so obvious mistakes fail locally; the server validates every monitor in detail. */
export const parseImportFile = (text: string): ParsedImport => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["This file is not valid JSON."] };
  }
  if (!isRecord(data)) return { ok: false, errors: ["This file is not an Upflare export."] };
  if (data.upflare !== 1) {
    return { ok: false, errors: [`Unsupported export version${data.upflare === undefined ? " (missing \"upflare\" field)" : `: ${JSON.stringify(data.upflare)}`}. Expected 1.`] };
  }

  const errors: string[] = [];
  if (!isRecord(data.settings)) errors.push("Missing \"settings\" object.");
  if (!Array.isArray(data.groups)) errors.push("Missing \"groups\" list.");
  if (!Array.isArray(data.monitors)) errors.push("Missing \"monitors\" list.");
  if (errors.length > 0) return { ok: false, errors };

  (data.groups as unknown[]).forEach((g, i) => {
    if (!isRecord(g) || typeof g.slug !== "string" || typeof g.name !== "string") errors.push(`groups[${i}] needs a "slug" and a "name".`);
  });
  (data.monitors as unknown[]).forEach((m, i) => {
    if (!isRecord(m) || typeof m.slug !== "string" || typeof m.name !== "string") errors.push(`monitors[${i}] needs a "slug" and a "name".`);
  });
  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, file: data as unknown as ExportFile };
};
