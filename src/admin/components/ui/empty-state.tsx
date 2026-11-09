import type { ReactNode } from "react";
import { Illustration, type IllustrationName } from "@/components/shared/Illustration";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  illustration?: IllustrationName;
  title: string;
  body: string;
  actions?: ReactNode;
  /** `lg` = a whole page with nothing in it yet (screen 07); `md` = a card or table. */
  size?: "md" | "lg";
};

export const EmptyState = ({ illustration, title, body, actions, size = "md" }: EmptyStateProps) => {
  const lg = size === "lg";
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-border bg-surface px-6 text-center",
        lg ? "gap-6 py-24" : "gap-4 py-12",
      )}
    >
      {illustration ? <Illustration name={illustration} className={lg ? "w-[360px] max-w-full" : "w-40"} /> : null}
      <div className={cn("flex flex-col", lg ? "max-w-md gap-2" : "max-w-sm gap-1")}>
        <h3 className={cn("font-semibold text-text", lg ? "text-2xl tracking-[-0.02em]" : "text-base")}>{title}</h3>
        <p className="text-sm text-muted">{body}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
};
