import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useSettingsSwitchAnimationsReady } from "./SettingsSwitchContext";

export interface SettingsPaneProps {
  title: string;
  /** Anchor for deep links and in-page jumps. */
  id?: string;
  description?: ReactNode;
  /** Render children without the rounded panel (tile grids, cards). */
  bare?: boolean;
  children: ReactNode;
}

/** Sentence-case heading over a rounded panel of rows. */
export function SettingsPane({ title, id, description, bare = false, children }: SettingsPaneProps) {
  return (
    <section id={id} className="settings-pane">
      <h2 className="settings-pane__title">{title}</h2>
      {description != null && description !== "" ? (
        <p className="settings-pane__lead">{description}</p>
      ) : null}
      {bare ? children : <div className="settings-panel">{children}</div>}
    </section>
  );
}

export interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** Points the label at its control. */
  htmlFor?: string;
  /** Leading element, e.g. a provider monogram. */
  leading?: ReactNode;
  /** Right-aligned control(s). */
  children?: ReactNode;
  testId?: string;
}

/** Label and description on the left, control on the right. */
export function SettingsRow({ label, description, htmlFor, leading, children, testId }: SettingsRowProps) {
  return (
    <div className="settings-row" data-testid={testId}>
      {leading}
      <div className="settings-row__text">
        {htmlFor ? (
          <label className="settings-row__label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="settings-row__label">{label}</span>
        )}
        {description != null && description !== "" ? (
          <span className="settings-row__desc">{description}</span>
        ) : null}
      </div>
      {children != null ? <div className="settings-row__control">{children}</div> : null}
    </div>
  );
}

export interface SettingsSwitchRowProps {
  id: string;
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  testId?: string;
  disabled?: boolean;
}

/** A whole row that toggles a switch on the right. */
export function SettingsSwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
  testId,
  disabled,
}: SettingsSwitchRowProps) {
  const animationsReady = useSettingsSwitchAnimationsReady();
  return (
    <label
      className={`settings-row settings-switch-row${animationsReady ? "" : " settings-switch-row--static"}`}
    >
      <span className="settings-row__text">
        <span className="settings-row__label">{label}</span>
        {description != null && description !== "" ? (
          <span className="settings-row__desc">{description}</span>
        ) : null}
      </span>
      <input
        id={id}
        data-testid={testId}
        type="checkbox"
        className="settings-switch-input"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="settings-switch-track" aria-hidden="true">
        <span className="settings-switch-thumb" />
      </span>
    </label>
  );
}

/** Free-form padded content inside a panel (inputs, grids, previews). */
export function SettingsPanelBlock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["settings-panel__block", className].filter(Boolean).join(" ")}>{children}</div>;
}

export interface SettingsDisclosureProps {
  label: string;
  description?: ReactNode;
  defaultOpen?: boolean;
  /** Rendered only while open, so expensive bodies load on demand. */
  children: ReactNode;
}

/** Row that expands to show more inside the same panel. */
export function SettingsDisclosure({ label, description, defaultOpen = false, children }: SettingsDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <>
      <button
        type="button"
        className={`settings-row settings-disclosure${open ? " settings-disclosure--open" : ""}`}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={14} strokeWidth={2} className="settings-disclosure__caret" aria-hidden />
        <span className="settings-row__text">
          <span className="settings-row__label">{label}</span>
          {description != null && description !== "" ? (
            <span className="settings-row__desc">{description}</span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div id={bodyId} className="settings-panel__block settings-disclosure__body">
          {children}
        </div>
      ) : null}
    </>
  );
}

export type SettingsPillTone = "ok" | "attention" | "idle";

/** Small status label for a row's right side. */
export function SettingsPill({ tone, children }: { tone: SettingsPillTone; children: ReactNode }) {
  return <span className={`settings-pill settings-pill--${tone}`}>{children}</span>;
}
