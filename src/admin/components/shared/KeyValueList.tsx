import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type KeyValueItem = { label: string; value: ReactNode; mono?: boolean };

export const KeyValueList = ({ items }: { items: KeyValueItem[] }) => (
  <dl className="flex flex-col divide-y divide-border">
    {items.map((item) => (
      <div key={item.label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
        <dt className="text-sm text-muted">{item.label}</dt>
        <dd className={cn("text-right text-sm text-text", item.mono && "font-mono")}>{item.value}</dd>
      </div>
    ))}
  </dl>
);
