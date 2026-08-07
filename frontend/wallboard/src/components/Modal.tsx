import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Dialog-backed modal keeping the existing open/title/onClose API. */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className={cn("max-h-[90vh] overflow-y-auto", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
