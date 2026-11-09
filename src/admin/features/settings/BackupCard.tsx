import { useRef, useState, type ChangeEvent } from "react";
import { CircleAlert, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import type { ExportFile } from "@shared/admin-api";
import { useExport } from "@/api/use-transfer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ImportDialog } from "@/features/settings/ImportDialog";
import { parseImportFile } from "@/features/settings/import-file";

export const BackupCard = () => {
  const exporter = useExport();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; file: ExportFile } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again
    if (!picked) return;
    const parsed = parseImportFile(await picked.text());
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors([]);
    setPending({ name: picked.name, file: parsed.file });
  };

  return (
    <Card className="max-w-[760px]" title="Backup" description="Move your setup between installs or keep a copy.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-text">Export JSON</h3>
            <p className="text-xs text-muted">Monitors, groups and settings. No secrets, no history.</p>
          </div>
          <Button
            variant="secondary"
            icon={Download}
            loading={exporter.isPending}
            onClick={() => exporter.mutate(undefined, { onError: () => toast.error("Couldn't export") })}
          >
            Export JSON
          </Button>
        </div>
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border p-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-text">Import JSON</h3>
            <p className="text-xs text-muted">Add or update monitors and groups from an export. You see a summary before anything changes.</p>
          </div>
          <input ref={input} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-label="Choose an export file" onChange={(e) => void onPick(e)} />
          <Button variant="secondary" icon={Upload} onClick={() => input.current?.click()}>
            Import JSON
          </Button>
        </div>
      </div>
      {errors.length > 0 ? (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-down-border bg-down-bg p-3 text-xs text-down-text">
          <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          <ul className="flex flex-col gap-1">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {pending ? <ImportDialog open fileName={pending.name} file={pending.file} onClose={() => setPending(null)} /> : null}
    </Card>
  );
};
