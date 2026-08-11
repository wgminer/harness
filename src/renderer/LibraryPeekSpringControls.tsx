import type { LibraryPeekTuning } from "./libraryPeek";
import { DEFAULT_LIBRARY_PEEK_TUNING } from "./libraryPeek";
import "./libraryPeekSpringControls.css";

type SliderSpec = {
  key: keyof LibraryPeekTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
};

const SLIDERS: SliderSpec[] = [
  {
    key: "stiffness",
    label: "Stiffness",
    min: 40,
    max: 800,
    step: 10,
    format: (v) => String(Math.round(v)),
  },
  {
    key: "damping",
    label: "Damping",
    min: 1,
    max: 40,
    step: 0.5,
    format: (v) => v.toFixed(1),
  },
  {
    key: "overshoot",
    label: "Overshoot",
    min: 0,
    max: 0.4,
    step: 0.01,
    format: (v) => v.toFixed(2),
  },
  {
    key: "peekMaxScreenRatio",
    label: "Peek max",
    min: 0,
    max: 0.5,
    step: 0.01,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    key: "zonePx",
    label: "Peek zone",
    min: 0,
    max: 400,
    step: 4,
    format: (v) => `${Math.round(v)}px`,
  },
  {
    key: "latchDurationMs",
    label: "Open duration",
    min: 120,
    max: 900,
    step: 10,
    format: (v) => `${Math.round(v)}ms`,
  },
  {
    key: "hoverCloseDelayMs",
    label: "Close delay",
    min: 0,
    max: 600,
    step: 10,
    format: (v) => `${Math.round(v)}ms`,
  },
];

type LibraryPeekSpringControlsProps = {
  value: LibraryPeekTuning;
  onChange: (next: LibraryPeekTuning) => void;
};

export function LibraryPeekSpringControls({ value, onChange }: LibraryPeekSpringControlsProps) {
  return (
    <aside className="library-peek-spring-controls" data-testid="library-peek-spring-controls">
      <header className="library-peek-spring-controls__header">
        <div>
          <strong>Library spring</strong>
          <p>Live peek / open tuning</p>
        </div>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => onChange({ ...DEFAULT_LIBRARY_PEEK_TUNING })}
        >
          Reset
        </button>
      </header>
      <div className="library-peek-spring-controls__body">
        {SLIDERS.map((slider) => {
          const current = value[slider.key];
          return (
            <label key={slider.key} className="library-peek-spring-controls__row">
              <span className="library-peek-spring-controls__label">
                <span>{slider.label}</span>
                <span className="library-peek-spring-controls__value">
                  {slider.format(current)}
                </span>
              </span>
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={current}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  onChange({ ...value, [slider.key]: nextValue });
                }}
              />
            </label>
          );
        })}
      </div>
      <p className="library-peek-spring-controls__hint">
        Peek max is a fraction of screen width (capped at full dock). Hover the
        revealed library to open it fully.
      </p>
    </aside>
  );
}
