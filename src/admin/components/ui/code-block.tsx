import { CopyButton } from "@/components/ui/copy-button";

export type CodeBlockProps = { caption: string; code: string };

export const CodeBlock = ({ caption, code }: CodeBlockProps) => (
  <figure className="overflow-hidden rounded-lg border border-border bg-surface-2">
    <figcaption className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
      <span className="font-mono text-xs text-muted">{caption}</span>
      <CopyButton value={code} />
    </figcaption>
    <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-text">
      <code>{code}</code>
    </pre>
  </figure>
);
