"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { WarningIcon } from "./icons";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";
type ButtonTone = "primary" | "secondary" | "destructive" | "quiet";

export function Button({ tone = "primary", className = "", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return <button className={`ui-button ui-button--${tone} ${className}`} type="button" {...props}>{children}</button>;
}

export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`panel ${className}`}>{children}</section>;
}

export function InlineAlert({ tone = "warning", title, children }: { tone?: Exclude<Tone, "neutral">; title: string; children: ReactNode }) {
  return <div className={`inline-alert inline-alert--${tone}`} role="alert"><WarningIcon /><div><strong>{title}</strong><p>{children}</p></div></div>;
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-state__mark" aria-hidden="true" /><h1>{title}</h1><p>{children}</p>{action ? <div className="empty-state__action">{action}</div> : null}</div>;
}

export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onClose }: { open: boolean; title: string; description: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={dialogRef} className="confirmation-dialog" aria-labelledby="confirmation-title" onCancel={(event) => { event.preventDefault(); onClose(); }}><form method="dialog" onSubmit={(event) => event.preventDefault()}><h2 id="confirmation-title">{title}</h2><p>{description}</p><div className="confirmation-dialog__actions"><Button tone="secondary" onClick={onClose}>انصراف</Button><Button tone="destructive" onClick={onConfirm}>{confirmLabel}</Button></div></form></dialog>;
}
