import { RadioGroup } from "radix-ui";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type RadioCardItem = { value: string; title: string; description: string; icon: LucideIcon };

export type RadioCardsProps = {
  value: string;
  onValueChange: (value: string) => void;
  items: RadioCardItem[];
  columns: 2 | 3;
  "aria-label"?: string;
};

export const RadioCards = ({ value, onValueChange, items, columns, ...aria }: RadioCardsProps) => (
  <RadioGroup.Root
    value={value}
    onValueChange={onValueChange}
    aria-label={aria["aria-label"]}
    className={cn("grid gap-3", columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-3")}
  >
    {items.map(({ icon: Icon, ...item }) => (
      <RadioGroup.Item
        key={item.value}
        value={item.value}
        className="group flex cursor-pointer flex-col gap-3 rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-border-strong data-[state=checked]:border-accent data-[state=checked]:bg-accent-bg data-[state=checked]:shadow-[0_0_0_1px_var(--accent)]"
      >
        <span className="flex w-full items-start justify-between">
          <span className="flex size-8 items-center justify-center rounded-md bg-accent-bg text-accent-text group-data-[state=checked]:bg-surface">
            <Icon size={16} aria-hidden />
          </span>
          <span className="flex size-4 items-center justify-center rounded-pill border border-border-strong group-data-[state=checked]:border-accent group-data-[state=checked]:border-[5px]" />
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text">{item.title}</span>
          <span className="text-xs text-muted">{item.description}</span>
        </span>
      </RadioGroup.Item>
    ))}
  </RadioGroup.Root>
);
