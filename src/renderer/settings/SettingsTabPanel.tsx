import type { ReactNode } from "react";
import type { SettingsTabId } from "./settingsNavConfig";

export interface SettingsTabPanelProps {
  id: SettingsTabId;
  children: ReactNode;
}

export function SettingsTabPanel({ id, children }: SettingsTabPanelProps) {
  return (
    <section
      id={`settings-panel-${id}`}
      className="settings-tab-panel"
      role="tabpanel"
      aria-labelledby={`settings-tab-${id}`}
    >
      {children}
    </section>
  );
}
