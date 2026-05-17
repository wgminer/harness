import type { ReactNode } from "react";

export function SettingsGroupContent({ children }: { children: ReactNode }) {
  return <div className="settings-group__content">{children}</div>;
}
