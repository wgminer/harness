import type { ReactNode } from "react";

export interface SettingsHintProps {
  children: ReactNode;
  flush?: boolean;
  className?: string;
}

export function SettingsHint({ children, flush, className }: SettingsHintProps) {
  const hintClass = [
    "settings-group__hint",
    flush ? "settings-group__hint--flush" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <p className={hintClass}>{children}</p>;
}
