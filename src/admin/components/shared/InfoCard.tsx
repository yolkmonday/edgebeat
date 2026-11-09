import type { ReactNode } from "react";

export const InfoCard = ({ title, children }: { title: string; children: ReactNode }) => (
  <aside className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-4">
    <h3 className="text-sm font-semibold text-text">{title}</h3>
    <div className="text-sm text-muted">{children}</div>
  </aside>
);
