import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string };

export type SelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  invalid?: boolean;
  id?: string;
  disabled?: boolean;
  className?: string;
  "aria-describedby"?: string;
};

export const Select = ({ value, onValueChange, options, placeholder, invalid, id, disabled, className, ...aria }: SelectProps) => (
  <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
    <SelectPrimitive.Trigger
      id={id}
      aria-invalid={invalid || undefined}
      aria-describedby={aria["aria-describedby"]}
      className={cn(
        "flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-surface px-3 text-sm text-text data-[placeholder]:text-muted focus:border-accent focus:shadow-[0_0_0_3px_var(--focus-ring)] disabled:opacity-50",
        invalid ? "border-down" : "border-border-strong",
        className,
      )}
    >
      <SelectPrimitive.Value placeholder={placeholder} />
      <SelectPrimitive.Icon>
        <ChevronDown size={16} className="text-muted" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface p-1 shadow-lg"
      >
        <SelectPrimitive.Viewport>
          {options.map((o) => (
            <SelectPrimitive.Item
              key={o.value}
              value={o.value}
              className="flex h-8 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 text-sm text-text outline-none data-[highlighted]:bg-surface-2"
            >
              <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              <SelectPrimitive.ItemIndicator>
                <Check size={14} aria-hidden />
              </SelectPrimitive.ItemIndicator>
            </SelectPrimitive.Item>
          ))}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
);
