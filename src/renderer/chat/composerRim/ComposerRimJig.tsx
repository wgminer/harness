import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  COMPOSER_RIM_PATTERNS,
  COMPOSER_RIM_COLORS,
  COMPOSER_RIM_RANGES,
  COMPOSER_RIM_WHEN,
  DEFAULT_COMPOSER_RIM,
  composerRimCssSnippet,
  composerRimStyle,
  readComposerRimSettings,
  writeComposerRimSettings,
  type ComposerRimColor,
  type ComposerRimPattern,
  type ComposerRimSettings,
  type ComposerRimWhen,
} from "./composerRim";
import "./composerRim.css";
import "./composerRimJig.css";

/** Flip to false once a look is picked and baked into the defaults. */
export const COMPOSER_RIM_JIG_ENABLED = true;

const PANEL_OPEN_KEY = "harness.composer-rim.jig-open";

function readPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(PANEL_OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Rim settings for the compose-mode composer, plus host props to spread on it. */
export function useComposerRim() {
  const [settings, setSettings] = useState<ComposerRimSettings>(() =>
    COMPOSER_RIM_JIG_ENABLED ? readComposerRimSettings() : { ...DEFAULT_COMPOSER_RIM },
  );

  useEffect(() => {
    if (COMPOSER_RIM_JIG_ENABLED) writeComposerRimSettings(settings);
  }, [settings]);

  return {
    settings,
    setSettings,
    hostProps: {
      "data-rim": settings.pattern,
      "data-rim-when": settings.when,
      style: composerRimStyle(settings),
    },
  };
}

export function ComposerRimJig({
  settings,
  onChange,
}: {
  settings: ComposerRimSettings;
  onChange: (next: ComposerRimSettings) => void;
}) {
  const [open, setOpen] = useState(readPanelOpen);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_OPEN_KEY, open ? "1" : "0");
    } catch {
      // Ignore quota / private-mode failures.
    }
  }, [open]);

  const patch = useCallback(
    (partial: Partial<ComposerRimSettings>) => onChange({ ...settings, ...partial }),
    [onChange, settings],
  );

  const copyCss = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(composerRimCssSnippet(settings));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }, [settings]);

  if (!COMPOSER_RIM_JIG_ENABLED) return null;

  if (!open) {
    return createPortal(
      <button type="button" className="rim-jig-tab" onClick={() => setOpen(true)}>
        Rim
      </button>,
      document.body,
    );
  }

  return createPortal(
    <aside className="rim-jig" aria-label="Composer rim jig">
      <header className="rim-jig__header">
        <h2 className="rim-jig__title">Composer rim</h2>
        <button type="button" className="rim-jig__link" onClick={() => setOpen(false)}>
          Hide
        </button>
      </header>

      <div className="rim-jig__chips" role="radiogroup" aria-label="Pattern">
        {COMPOSER_RIM_PATTERNS.map((pattern) => (
          <button
            key={pattern}
            type="button"
            role="radio"
            aria-checked={settings.pattern === pattern}
            className={`rim-jig__chip${settings.pattern === pattern ? " rim-jig__chip--on" : ""}`}
            onClick={() => patch({ pattern: pattern as ComposerRimPattern })}
          >
            {pattern}
          </button>
        ))}
      </div>

      <label className="rim-jig__row rim-jig__row--select">
        <span className="rim-jig__label">Show</span>
        <select
          value={settings.when}
          onChange={(e) => patch({ when: e.target.value as ComposerRimWhen })}
        >
          {COMPOSER_RIM_WHEN.map((when) => (
            <option key={when} value={when}>
              {when === "always" ? "Always" : when === "idle" ? "Until focused" : "While focused"}
            </option>
          ))}
        </select>
      </label>

      <label className="rim-jig__row rim-jig__row--select">
        <span className="rim-jig__label">Color</span>
        <select
          value={settings.color}
          onChange={(e) => patch({ color: e.target.value as ComposerRimColor })}
        >
          {COMPOSER_RIM_COLORS.map((color) => (
            <option key={color} value={color}>
              {color === "accent" ? "App accent" : "Custom"}
            </option>
          ))}
        </select>
      </label>

      <div className="rim-jig__sliders">
        {COMPOSER_RIM_RANGES.filter((range) => !range.customOnly || settings.color === "custom").map((range) => (
          <label key={range.key} className="rim-jig__row">
            <span className="rim-jig__label">{range.label}</span>
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={range.step}
              value={settings[range.key]}
              onChange={(e) => patch({ [range.key]: Number(e.target.value) })}
              onDoubleClick={() => patch({ [range.key]: DEFAULT_COMPOSER_RIM[range.key] })}
            />
            <span className="rim-jig__value">
              {settings[range.key]}
              {range.unit ?? ""}
            </span>
          </label>
        ))}
      </div>

      <footer className="rim-jig__footer">
        <button type="button" className="rim-jig__link" onClick={() => onChange({ ...DEFAULT_COMPOSER_RIM })}>
          Reset
        </button>
        <button type="button" className="rim-jig__link" onClick={() => void copyCss()}>
          {copied ? "Copied" : "Copy CSS"}
        </button>
      </footer>
    </aside>,
    document.body,
  );
}
