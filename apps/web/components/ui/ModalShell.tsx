"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  maxWidthClassName?: string;
}

export function ModalShell({
  isOpen,
  onClose,
  title,
  children,
  maxWidthClassName = "max-w-md",
}: ModalShellProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn(
          "w-full rounded-[var(--radius-xl)] bg-[var(--surface-strong)] border border-[var(--border)] shadow-[0_18px_45px_rgba(20,20,19,0.18)] overflow-hidden",
          maxWidthClassName
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-3 p-5 border-b border-[var(--border-soft)] bg-[var(--surface)]">
            <div className="type-section font-semibold text-[var(--foreground)]">
              {title}
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-[var(--radius-pill)] hover:bg-[var(--state-hover)] transition-colors duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
              aria-label="Close modal"
              type="button"
            >
              <X size={20} />
            </button>
          </div>
        )}

        <div className="p-0">{children}</div>
      </div>
    </div>
  );
}

