import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";

export type ConfirmDialogProps = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const ConfirmDialog = ({ title, body, confirmLabel, destructive, loading, onConfirm, open, onOpenChange }: ConfirmDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      title={title}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button variant={destructive ? "destructive" : "primary"} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{body}</div>
    </DialogContent>
  </Dialog>
);
