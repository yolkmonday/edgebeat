import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import type { ExportFile, ImportSummary } from "@shared/admin-api";
import { useImport } from "@/api/use-transfer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError, type ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

type Bucket = ImportSummary["monitors"];

const total = (s: ImportSummary, key: keyof Bucket) => s.groups[key].length + s.monitors[key].length;

const errorLines = (e: unknown): string[] => {
  if (!isApiError(e)) return ["Couldn't reach the server. Try again."];
  if (e.code === "too_large") return ["This file is too large to import in one request. Split it into smaller files."];
  if (e.code === "budget_exceeded") return ["Importing this file would raise checks per minute above your budget."];
  if (e.issues.length > 0) return e.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`);
  return [(e as ApiError).code];
};

const SlugList = ({ label, slugs, tone }: { label: string; slugs: string[]; tone?: "bad" }) =>
  slugs.length === 0 ? null : (
    <p className="text-xs">
      <span className={cn("font-medium", tone === "bad" ? "text-down-text" : "text-text")}>{label}: </span>
      <span className="font-mono text-muted">{slugs.join(", ")}</span>
    </p>
  );

const Section = ({ title, bucket }: { title: string; bucket: Bucket }) =>
  bucket.created.length + bucket.updated.length + bucket.deleted.length === 0 ? null : (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-semibold text-text">{title}</h4>
      <SlugList label="Creates" slugs={bucket.created} />
      <SlugList label="Updates" slugs={bucket.updated} />
      <SlugList label="Deletes" slugs={bucket.deleted} tone="bad" />
    </div>
  );

export type ImportDialogProps = { open: boolean; file: ExportFile; fileName: string; onClose: () => void };

export const ImportDialog = ({ open, file, fileName, onClose }: ImportDialogProps) => {
  const [prune, setPrune] = useState(false);
  const preview = useImport();
  const run = useImport();
  const { mutate: dryRun } = preview;

  useEffect(() => {
    dryRun({ file, prune, dryRun: true });
  }, [dryRun, file, prune]);

  const summary = preview.data;
  const deletes = summary ? total(summary, "deleted") : 0;
  const nothing = summary ? total(summary, "created") + total(summary, "updated") + deletes === 0 && !summary.settingsChanged : false;

  const confirm = () =>
    run.mutate(
      { file, prune, dryRun: false },
      {
        onSuccess: (s) => {
          toast.success(`Imported: ${total(s, "created")} created, ${total(s, "updated")} updated, ${total(s, "deleted")} deleted`);
          onClose();
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-lg"
        title="Import configuration"
        description={<span className="font-mono">{fileName}</span>}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant={prune && deletes > 0 ? "destructive" : "primary"}
              loading={run.isPending}
              disabled={!summary || preview.isPending || nothing}
              onClick={confirm}
            >
              Import
            </Button>
          </>
        }
      >
        {preview.isPending ? (
          <Skeleton className="h-24" />
        ) : summary ? (
          <div className="flex flex-col gap-4" aria-live="polite">
            <p className="text-sm font-medium text-text">
              Creates {total(summary, "created")}, updates {total(summary, "updated")}, deletes {deletes}
            </p>
            {summary.settingsChanged ? <p className="text-xs text-muted">Site name, plan and check budget will change.</p> : null}
            {nothing ? <p className="text-xs text-muted">Nothing would change.</p> : null}
            <Section title="Monitors" bucket={summary.monitors} />
            <Section title="Groups" bucket={summary.groups} />
          </div>
        ) : null}
        {preview.isError || run.isError ? (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-down-border bg-down-bg p-3 text-xs text-down-text">
            <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
            <ul className="flex flex-col gap-1">
              {errorLines(run.error ?? preview.error).map((line) => (
                <li key={line} className="font-mono">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <label className={cn("flex items-start gap-2 text-sm", prune ? "text-down-text" : "text-text")}>
          <input type="checkbox" checked={prune} onChange={(e) => setPrune(e.target.checked)} className="mt-0.5 size-4 accent-[var(--down)]" />
          Delete monitors and groups that are not in the file
        </label>
      </DialogContent>
    </Dialog>
  );
};
