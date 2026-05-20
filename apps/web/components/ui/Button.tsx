"use client";

import React from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "filled" | "tonal" | "outlined" | "text";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  className,
  variant = "filled",
  size = "md",
  disabled,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius-pill)] font-medium transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

  const sizeClass =
    size === "sm"
      ? "h-9 px-4 type-caption"
      : size === "lg"
        ? "h-12 px-8 type-body"
        : "h-10 px-6 type-caption md:type-body";

  const variantClass =
    variant === "filled"
      ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_0_0_1px_var(--accent)] hover:bg-[var(--accent-strong)] hover:shadow-[0_0_0_1px_var(--accent-strong)]"
      : variant === "tonal"
        ? "bg-[var(--surface-muted)] text-[var(--foreground)] shadow-[0_0_0_1px_var(--border)] hover:bg-[var(--surface)] hover:shadow-[0_0_0_1px_var(--text-subtle)]"
        : variant === "outlined"
          ? "bg-transparent border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface)] hover:border-[var(--text-subtle)]"
          : "bg-transparent text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]";

  const disabledClass = "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none";

  return (
    <button
      className={cn(base, sizeClass, variantClass, disabledClass, className)}
      disabled={disabled}
      {...props}
    />
  );
}

