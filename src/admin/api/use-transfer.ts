import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ExportFile, ImportSummary } from "@shared/admin-api";
import { api } from "@/lib/api";

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const useExport = () =>
  useMutation({
    mutationFn: async () => {
      const blob = await api.download("/export");
      saveBlob(blob, `upflare-config-${new Date().toISOString().slice(0, 10)}.json`);
    },
  });

export const useImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, prune, dryRun }: { file: ExportFile; prune: boolean; dryRun: boolean }) =>
      api.post<ImportSummary>(`/import?prune=${prune}&dryRun=${dryRun}`, file),
    onSuccess: (summary) => (summary.dryRun ? undefined : qc.invalidateQueries()),
  });
};
