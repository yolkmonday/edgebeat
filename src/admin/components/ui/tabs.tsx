import { Tabs as TabsPrimitive } from "radix-ui";

export type TabItem = { value: string; label: string; count?: number };

export type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  items: TabItem[];
  "aria-label"?: string;
};

/** Segmented control. Panels are rendered by the caller based on `value`. */
export const Tabs = ({ value, onValueChange, items, ...aria }: TabsProps) => (
  <TabsPrimitive.Root value={value} onValueChange={onValueChange}>
    <TabsPrimitive.List
      aria-label={aria["aria-label"]}
      className="inline-flex gap-1 rounded-md border border-border bg-surface-2 p-1"
    >
      {items.map((item) => (
        <TabsPrimitive.Trigger
          key={item.value}
          value={item.value}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-sm text-muted transition-colors hover:text-text data-[state=active]:bg-surface data-[state=active]:font-medium data-[state=active]:text-text data-[state=active]:shadow-sm"
        >
          {item.label}
          {item.count === undefined ? null : <span className="font-mono text-xs text-muted">{item.count}</span>}
        </TabsPrimitive.Trigger>
      ))}
    </TabsPrimitive.List>
  </TabsPrimitive.Root>
);
