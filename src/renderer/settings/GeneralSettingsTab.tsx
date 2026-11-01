import type { CSSProperties } from "react";
import { ACCENT_PRESETS, applyAccent, normalizeAccentHex } from "../../shared/accent";
import { WORLD_CLOCK_HOUR_COLORS, applyAppearanceTheme } from "../../shared/timeOfDayBackground";
import type { AppearanceTheme } from "../../shared/types";
import { applyCropCursor } from "../ui/cursors/whipCursor";
import { SettingsPane, SettingsPanelBlock, SettingsRow, SettingsSwitchRow } from "./SettingsPanel";
import { SettingsTabPanel } from "./SettingsTabPanel";

const THEMES: ReadonlyArray<{
  id: AppearanceTheme;
  name: string;
  note: string;
  mini: { bg: string; side: string; bar: string };
}> = [
  { id: "dark", name: "Dark", note: "Always", mini: { bg: "#111", side: "#181818", bar: "#262626" } },
  { id: "light", name: "Light", note: "Always", mini: { bg: "#f4f4f2", side: "#eaeae7", bar: "#dcdcd8" } },
  { id: "time", name: "Time", note: "Follows the hour", mini: { bg: "#141a24", side: "#1a2130", bar: "#2a3346" } },
];

/** Every other hour, midnight to 10 pm, for the Time card's strip. */
const HOUR_STRIP = WORLD_CLOCK_HOUR_COLORS.filter((_, hour) => hour % 2 === 0);

export interface GeneralSettingsTabProps {
  appearanceTheme: AppearanceTheme;
  setAppearanceTheme: (theme: AppearanceTheme) => void;
  accent: string;
  setAccent: (hex: string) => void;
  cropCursor: boolean;
  setCropCursor: (value: boolean) => void;
  openToComposeOnLaunch: boolean;
  setOpenToComposeOnLaunch: (value: boolean) => void;
  weatherZip: string;
  setWeatherZip: (value: string) => void;
  selectionImageLookup: boolean;
  setSelectionImageLookup: (value: boolean) => void;
}

export function GeneralSettingsTab({
  appearanceTheme,
  setAppearanceTheme,
  accent,
  setAccent,
  cropCursor,
  setCropCursor,
  openToComposeOnLaunch,
  setOpenToComposeOnLaunch,
  weatherZip,
  setWeatherZip,
  selectionImageLookup,
  setSelectionImageLookup,
}: GeneralSettingsTabProps) {
  const normalizedAccent = normalizeAccentHex(accent);
  const isPreset = ACCENT_PRESETS.some((p) => normalizeAccentHex(p.hex) === normalizedAccent);

  const chooseTheme = (theme: AppearanceTheme) => {
    applyAppearanceTheme(theme);
    setAppearanceTheme(theme);
  };

  const chooseAccent = (raw: string) => {
    const hex = normalizeAccentHex(raw);
    applyAccent(hex);
    setAccent(hex);
  };

  return (
    <SettingsTabPanel id="general">
      <SettingsPane title="Appearance">
        <SettingsPanelBlock>
          <div className="settings-theme-cards" role="radiogroup" aria-label="Theme" data-testid="settings-theme-mode">
            {THEMES.map((theme) => {
              const selected = appearanceTheme === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`settings-theme-card${selected ? " settings-theme-card--selected" : ""}`}
                  onClick={() => chooseTheme(theme.id)}
                >
                  <span
                    className="settings-theme-mini"
                    aria-hidden
                    style={
                      {
                        "--mini-bg": theme.mini.bg,
                        "--mini-side": theme.mini.side,
                        "--mini-bar": theme.mini.bar,
                      } as CSSProperties
                    }
                  >
                    <span className="settings-theme-mini__side" />
                    <span className="settings-theme-mini__main">
                      <span className="settings-theme-mini__bar" style={{ width: "70%" }} />
                      <span className="settings-theme-mini__bar" style={{ width: "48%" }} />
                      <span className="settings-theme-mini__accent" />
                    </span>
                  </span>
                  {theme.id === "time" ? (
                    <span className="settings-theme-hours" aria-hidden>
                      {HOUR_STRIP.map((hex, i) => (
                        <span key={i} style={{ background: hex }} />
                      ))}
                    </span>
                  ) : null}
                  <span className="settings-theme-card__name">
                    {theme.name}
                    <small>{theme.note}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </SettingsPanelBlock>
        <SettingsRow label="Accent" description="Buttons, focus and links." testId="settings-accent">
          <div className="settings-swatches" role="radiogroup" aria-label="Accent color">
            {ACCENT_PRESETS.map((preset) => {
              const selected = normalizeAccentHex(preset.hex) === normalizedAccent;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={preset.label}
                  title={preset.label}
                  className={`settings-swatch${selected ? " settings-swatch--selected" : ""}`}
                  style={{ "--swatch": preset.hex } as CSSProperties}
                  onClick={() => chooseAccent(preset.hex)}
                />
              );
            })}
            <span
              className={`settings-swatch settings-swatch--custom${isPreset ? "" : " settings-swatch--selected"}`}
              title="Custom color"
            >
              <input
                type="color"
                aria-label="Custom accent color"
                value={normalizedAccent}
                onChange={(e) => chooseAccent(e.target.value)}
              />
            </span>
          </div>
        </SettingsRow>
        <SettingsSwitchRow
          id="cropCursorToggle"
          testId="settings-crop-cursor"
          label="Riding crop cursor"
          checked={cropCursor}
          onChange={(e) => {
            setCropCursor(e.target.checked);
            applyCropCursor(e.target.checked);
          }}
        />
      </SettingsPane>

      <SettingsPane title="Launch">
        <SettingsSwitchRow
          id="openToComposeOnLaunchToggle"
          testId="settings-open-to-compose-on-launch"
          label="Open to compose"
          description="Start on a new chat instead of where you left off."
          checked={openToComposeOnLaunch}
          onChange={(e) => setOpenToComposeOnLaunch(e.target.checked)}
        />
        <SettingsRow
          label="Weather ZIP"
          description="US ZIP for the temperature on the compose screen."
          htmlFor="settings-weather-zip"
        >
          <input
            id="settings-weather-zip"
            data-testid="settings-weather-zip"
            className="settings-zip-input"
            type="text"
            value={weatherZip}
            onChange={(e) => setWeatherZip(e.target.value)}
            placeholder="12528"
            inputMode="numeric"
            autoComplete="postal-code"
            spellCheck={false}
            maxLength={5}
          />
        </SettingsRow>
      </SettingsPane>

      <SettingsPane title="Chat">
        <SettingsSwitchRow
          id="selectionImageLookupToggle"
          testId="settings-selection-image-lookup"
          label="Look up images on selection"
          description="Select text in a reply to search for pictures of it."
          checked={selectionImageLookup}
          onChange={(e) => setSelectionImageLookup(e.target.checked)}
        />
      </SettingsPane>
    </SettingsTabPanel>
  );
}
