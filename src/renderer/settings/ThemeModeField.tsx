import { applyAppearanceTheme } from "../../shared/timeOfDayBackground";
import { type AppearanceTheme } from "../../shared/types";

const OPTIONS: ReadonlyArray<{ id: AppearanceTheme; label: string }> = [
  { id: "dark", label: "Dark" },
  { id: "time", label: "Time" },
];

export interface ThemeModeFieldProps {
  value: AppearanceTheme;
  onChange: (theme: AppearanceTheme) => void;
}

export function ThemeModeField({ value, onChange }: ThemeModeFieldProps) {
  return (
    <div className="settings-section" data-testid="settings-theme-mode">
      <div
        className="settings-system-prompt-toggle"
        role="radiogroup"
        aria-label="Theme"
      >
        {OPTIONS.map((option) => {
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`settings-system-prompt-toggle__btn${
                selected ? " settings-system-prompt-toggle__btn--active" : ""
              }`}
              onClick={() => {
                applyAppearanceTheme(option.id);
                onChange(option.id);
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
