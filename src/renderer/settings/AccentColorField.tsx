import { useEffect, useState, type CSSProperties } from "react";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  applyAccent,
  isValidAccentHex,
  normalizeAccentHex,
} from "../../shared/accent";
import { SettingsField } from "./SettingsField";

export interface AccentColorFieldProps {
  value: string;
  onChange: (hex: string) => void;
}

export function AccentColorField({ value, onChange }: AccentColorFieldProps) {
  const normalized = normalizeAccentHex(value);
  const [draft, setDraft] = useState(normalized);

  useEffect(() => {
    setDraft(normalized);
  }, [normalized]);

  const commit = (raw: string) => {
    const next = normalizeAccentHex(raw);
    setDraft(next);
    applyAccent(next);
    onChange(next);
  };

  return (
    <SettingsField label="Accent color" htmlFor="settings-accent-hex">
      <div className="settings-accent" data-testid="settings-accent">
        <div className="settings-accent__row">
          <input
            id="settings-accent-picker"
            className="settings-accent__picker"
            type="color"
            value={normalized}
            aria-label="Pick accent color"
            onChange={(e) => commit(e.target.value)}
          />
          <input
            id="settings-accent-hex"
            className="settings-accent__hex"
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={draft}
            aria-label="Accent color hex"
            onChange={(e) => {
              const next = e.target.value;
              setDraft(next);
              if (isValidAccentHex(next)) {
                const hex = normalizeAccentHex(next);
                applyAccent(hex);
                onChange(hex);
              }
            }}
            onBlur={() => {
              if (!isValidAccentHex(draft)) {
                setDraft(normalized);
                return;
              }
              commit(draft);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
          />
          {normalized !== DEFAULT_ACCENT ? (
            <button
              type="button"
              className="btn settings-accent__reset"
              onClick={() => commit(DEFAULT_ACCENT)}
            >
              Reset
            </button>
          ) : null}
        </div>
        <div className="settings-accent__presets" role="list" aria-label="Accent presets">
          {ACCENT_PRESETS.map((preset) => {
            const selected = normalizeAccentHex(preset.hex) === normalized;
            return (
              <button
                key={preset.id}
                type="button"
                role="listitem"
                className={[
                  "settings-accent__swatch",
                  selected ? "settings-accent__swatch--selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--swatch": preset.hex } as CSSProperties}
                title={preset.label}
                aria-label={preset.label}
                aria-pressed={selected}
                onClick={() => commit(preset.hex)}
              />
            );
          })}
        </div>
      </div>
    </SettingsField>
  );
}
