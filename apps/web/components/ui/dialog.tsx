"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./button";
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: React.ReactNode;
  busy?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <D.Portal>
        <D.Overlay className="dialog-overlay" />
        <D.Content className="dialog">
          <D.Title>{title}</D.Title>
          <D.Description asChild>
            <div className="muted">{children}</div>
          </D.Description>
          <div className="actions">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button disabled={busy} onClick={onConfirm}>
              {busy ? "处理中…" : "确认操作"}
            </Button>
          </div>
          <D.Close className="dialog-close" aria-label="关闭">
            <X size={18} />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
