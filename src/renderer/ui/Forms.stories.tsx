import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Section, SettingsFrame } from "./storyHelpers";

function FormsGallery() {
  const [secretVisible, setSecretVisible] = useState(false);
  const [checked, setChecked] = useState(true);

  return (
    <div>
      <Section title=".input-base" stack>
        <input className="input-base" defaultValue="Shared text input" />
        <input className="input-base" placeholder="Placeholder" />
        <input className="input-base" disabled defaultValue="Disabled" />
      </Section>

      <Section title="Modal fields" stack>
        <div className="app-modal-stack" style={{ maxWidth: 440 }}>
          <label className="app-modal-field">
            <span className="app-modal-field__label">Title</span>
            <input className="app-modal-input" defaultValue="Weekly review" />
            <span className="app-modal-field__hint">Shown in the sidebar list</span>
          </label>
          <label className="app-modal-field">
            <span className="app-modal-field__label">Notes</span>
            <textarea
              className="app-modal-input app-modal-input--multiline"
              rows={3}
              defaultValue="Multiline modal body…"
            />
          </label>
          <label className="app-modal-check">
            <input
              type="checkbox"
              className="app-modal-check__input"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span className="app-modal-check__icon" aria-hidden />
            <span className="app-modal-check__text">Pin to top</span>
          </label>
        </div>
      </Section>

      <Section title="Settings inputs" stack>
        <SettingsFrame>
          <input type="text" defaultValue="Settings text field" />
          <select defaultValue="a">
            <option value="a">Option A</option>
            <option value="b">Option B</option>
          </select>
          <textarea rows={3} defaultValue="Settings textarea" />
          <div className="settings-api-key-row">
            <input
              type={secretVisible ? "text" : "password"}
              defaultValue="sk-••••••••••••"
              readOnly
            />
            <button
              type="button"
              className="btn btn-icon"
              aria-label={secretVisible ? "Hide" : "Show"}
              onClick={() => setSecretVisible((v) => !v)}
            >
              {secretVisible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </SettingsFrame>
      </Section>

      <Section title="Accent picker" stack>
        <SettingsFrame>
          <div className="settings-accent">
            <div className="settings-accent__row">
              <input className="settings-accent__picker" type="color" defaultValue="#5b9cf5" />
              <input className="settings-accent__hex" defaultValue="#5b9cf5" />
              <button type="button" className="btn btn-outline settings-accent__reset">
                Reset
              </button>
            </div>
            <div className="settings-accent__presets">
              {["#5b9cf5", "#e06c75", "#98c379", "#e5c07b", "#c678dd"].map((hex, i) => (
                <button
                  key={hex}
                  type="button"
                  className={`settings-accent__swatch${i === 0 ? " settings-accent__swatch--selected" : ""}`}
                  style={{ background: hex }}
                  aria-label={hex}
                />
              ))}
            </div>
          </div>
        </SettingsFrame>
      </Section>

      <Section title="Tasks modal inputs" stack>
        <input className="tasks-modal-title-input" defaultValue="Ship Storybook catalog" />
        <textarea className="tasks-textarea" rows={3} defaultValue="Task notes…" />
      </Section>
    </div>
  );
}

const meta = {
  title: "UI/Forms",
  component: FormsGallery,
} satisfies Meta<typeof FormsGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
