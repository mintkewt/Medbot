"use client";

import React from "react";
import { cn } from "@/lib/cn";

interface ChipProps {
  children: React.ReactNode;
  className?: string;
}

export function Chip({ children, className }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]",
        "type-caption transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)]",
        className
      )}
    >
      {children}
    </span>
  );
}

