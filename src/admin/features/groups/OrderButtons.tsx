import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export type OrderButtonsProps = {
  name: string;
  index: number;
  count: number;
  disabled?: boolean;
  onMove: (dir: -1 | 1) => void;
};

export const OrderButtons = ({ name, index, count, disabled, onMove }: OrderButtonsProps) => (
  <span className="inline-flex items-center gap-1">
    <Button variant="ghost" size="sm" className="px-2" aria-label={`Move ${name} up`} disabled={disabled || index === 0} onClick={() => onMove(-1)}>
      <ArrowUp size={14} aria-hidden />
    </Button>
    <Button variant="ghost" size="sm" className="px-2" aria-label={`Move ${name} down`} disabled={disabled || index === count - 1} onClick={() => onMove(1)}>
      <ArrowDown size={14} aria-hidden />
    </Button>
  </span>
);
