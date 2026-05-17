import type { ReactNode } from "react";

export interface SettingsFieldProps {
  label: ReactNode;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}

export function SettingsField({ label, htmlFor, className, children }: SettingsFieldProps) {
  const sectionClass = ["settings-section", className].filter(Boolean).join(" ");

  return (
    <div className={sectionClass}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
