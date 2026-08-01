import type { ReactNode } from "react";

export interface SettingsSubsectionProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/** Labeled block inside a SettingsGroup — caption heading, optional lead, stacked content. */
export function SettingsSubsection({ title, description, children }: SettingsSubsectionProps) {
  return (
    <section className="settings-subsection">
      <h3 className="settings-subsection__title">{title}</h3>
      <div className="settings-subsection__body">
        {description != null && description !== "" ? (
          <p className="settings-subsection__description">{description}</p>
        ) : null}
        <div className="settings-subsection__content">{children}</div>
      </div>
    </section>
  );
}
