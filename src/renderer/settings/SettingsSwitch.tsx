import type { ChangeEvent } from "react";
import { useSettingsSwitchAnimationsReady } from "./SettingsSwitchContext";

export interface SettingsSwitchProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  testId?: string;
  disabled?: boolean;
}

export function SettingsSwitch({ id, label, checked, onChange, testId, disabled }: SettingsSwitchProps) {
  const animationsReady = useSettingsSwitchAnimationsReady();

  return (
    <label
      className={`settings-switch-row${animationsReady ? "" : " settings-switch-row--static"}`}
    >
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
      <span className="settings-switch-text">{label}</span>
    </label>
  );
}
