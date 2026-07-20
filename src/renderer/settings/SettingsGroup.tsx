import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { SettingsGroupContent } from "./SettingsGroupContent";

export interface SettingsGroupProps {
  title: string;
  description?: ReactNode;
  descriptionClassName?: string;
  children: ReactNode;
  /** When true, the title becomes a disclosure control for the body. */
  collapsible?: boolean;
  /** Initial open state when `collapsible`. Defaults to true. */
  defaultOpen?: boolean;
}

export function SettingsGroup({
  title,
  description,
  descriptionClassName,
  children,
  collapsible = false,
  defaultOpen = true,
}: SettingsGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const headingId = useId();

  const leadClass = ["settings-group__lead", descriptionClassName].filter(Boolean).join(" ");

  const titleNode = collapsible ? (
    <button
      type="button"
      className="settings-group__toggle"
      id={headingId}
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => setOpen((value) => !value)}
    >
      <ChevronRight
        size={16}
        strokeWidth={2}
        className={`settings-group__caret${open ? " settings-group__caret--open" : ""}`}
        aria-hidden
      />
      <span className="settings-group__title">{title}</span>
    </button>
  ) : (
    <h3 className="settings-group__title" id={headingId}>
      {title}
    </h3>
  );

  return (
    <section className={`settings-group${collapsible ? " settings-group--collapsible" : ""}`}>
      {titleNode}
      <div
        id={collapsible ? panelId : undefined}
        role={collapsible ? "region" : undefined}
        aria-labelledby={collapsible ? headingId : undefined}
        hidden={collapsible ? !open : undefined}
      >
        {description != null && description !== "" ? <p className={leadClass}>{description}</p> : null}
        <SettingsGroupContent>{children}</SettingsGroupContent>
      </div>
    </section>
  );
}
