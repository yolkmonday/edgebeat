import type { ReactNode } from "react";
import { Illustration, type IllustrationName } from "@/components/shared/Illustration";

export type EmptyStateProps = {
  illustration?: IllustrationName;
  title: string;
  body: string;
  actions?: ReactNode;
};

export const EmptyState = ({ illustration, title, body, actions }: EmptyStateProps) => (
  <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
    {illustration ? <Illustration name={illustration} className="w-40" /> : null}
    <div className="flex max-w-sm flex-col gap-1">
      <h3 className="text-base font-semibold text-text">{title}</h3>
      <p className="text-sm text-muted">{body}</p>
    </div>
    {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
  </div>
);
