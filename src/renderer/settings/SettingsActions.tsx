import type { ReactNode } from "react";

export interface SettingsActionsProps {
  children: ReactNode;
  className?: string;
}

export function SettingsActions({ children, className }: SettingsActionsProps) {
  const actionsClass = ["settings-actions", className].filter(Boolean).join(" ");

  return <div className={actionsClass}>{children}</div>;
}
