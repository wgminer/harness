import type { ReactNode } from "react";
import { SettingsGroupContent } from "./SettingsGroupContent";

export interface SettingsGroupProps {
  title: string;
  description?: ReactNode;
  descriptionClassName?: string;
  children: ReactNode;
}

export function SettingsGroup({ title, description, descriptionClassName, children }: SettingsGroupProps) {
  const leadClass = [
    "settings-group__lead",
    descriptionClassName,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="settings-group">
      <h3 className="settings-group__title">{title}</h3>
      {description != null && description !== "" ? <p className={leadClass}>{description}</p> : null}
      <SettingsGroupContent>{children}</SettingsGroupContent>
    </section>
  );
}
