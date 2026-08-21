import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ChatModePicker } from "../ChatModePicker";
import type { ChatModeId } from "../../shared/chatModes";
import { SettingsSwitch } from "../settings/SettingsSwitch";
import { SettingsSwitchProvider } from "../settings/SettingsSwitchContext";
import { Section } from "./storyHelpers";

function TogglesGallery() {
  const [mode, setMode] = useState<ChatModeId>("chat");
  const [sidebar, setSidebar] = useState<"left" | "right">("left");
  const [platform, setPlatform] = useState<"desktop" | "ios">("desktop");
  const [tab, setTab] = useState("general");
  const [syncOn, setSyncOn] = useState(true);
  const [toolsOn, setToolsOn] = useState(false);

  return (
    <div>
      <Section title="Chat mode picker (dropdown)" stack>
        <ChatModePicker value={mode} onChange={setMode} />
      </Section>

      <Section title="Chat mode picker (outline strip)" stack>
        <ChatModePicker value={mode} onChange={setMode} variant="outline" />
      </Section>

      <Section title="Settings segmented" stack>
        <div className="settings-segmented" role="radiogroup" aria-label="Sidebar position">
          <button
            type="button"
            role="radio"
            className={`settings-segment${sidebar === "left" ? " settings-segment--active" : ""}`}
            aria-checked={sidebar === "left"}
            onClick={() => setSidebar("left")}
          >
            Left
          </button>
          <button
            type="button"
            role="radio"
            className={`settings-segment${sidebar === "right" ? " settings-segment--active" : ""}`}
            aria-checked={sidebar === "right"}
            onClick={() => setSidebar("right")}
          >
            Right
          </button>
        </div>
      </Section>

      <Section title="System prompt toggle (not .btn)" stack>
        <div className="settings-prompt-preview-controls">
          <div className="settings-prompt-preview-controls__group">
            <span className="settings-prompt-preview-controls__label">Platform</span>
            <div className="settings-system-prompt-toggle" role="tablist">
              <button
                type="button"
                role="tab"
                className={`settings-system-prompt-toggle__btn${platform === "desktop" ? " settings-system-prompt-toggle__btn--active" : ""}`}
                aria-selected={platform === "desktop"}
                onClick={() => setPlatform("desktop")}
              >
                Desktop
              </button>
              <button
                type="button"
                role="tab"
                className={`settings-system-prompt-toggle__btn${platform === "ios" ? " settings-system-prompt-toggle__btn--active" : ""}`}
                aria-selected={platform === "ios"}
                onClick={() => setPlatform("ios")}
              >
                iOS
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Settings header tabs" stack>
        <div className="settings-tabs settings-tabs--header" role="tablist">
          {["general", "models", "data", "memory"].map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={`settings-tab${tab === id ? " settings-tab--active" : ""}`}
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {id[0]!.toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Settings switches" stack>
        <SettingsSwitchProvider animationsReady={false}>
          <SettingsSwitch
            id="story-sync"
            label="Sync conversations"
            checked={syncOn}
            onChange={(e) => setSyncOn(e.target.checked)}
          />
          <SettingsSwitch
            id="story-tools"
            label="Enable tools"
            checked={toolsOn}
            onChange={(e) => setToolsOn(e.target.checked)}
          />
          <SettingsSwitch
            id="story-disabled"
            label="Disabled switch"
            checked={false}
            onChange={() => {}}
            disabled
          />
        </SettingsSwitchProvider>
      </Section>

      <Section title="Image canvas segmented" stack>
        <div className="image-canvas__segmented" role="group" aria-label="Generate mode">
          <button type="button" className="image-canvas__segment image-canvas__segment--active">
            Draft
          </button>
          <button type="button" className="image-canvas__segment">
            Final
          </button>
        </div>
        <div className="image-canvas__segmented" role="group" aria-label="Aspect ratio">
          <button type="button" className="image-canvas__segment image-canvas__segment--active">
            Square
          </button>
          <button type="button" className="image-canvas__segment">
            Landscape
          </button>
          <button type="button" className="image-canvas__segment">
            Portrait
          </button>
        </div>
      </Section>

      <Section title="Tooltip">
        <span className="tooltip">
          <button type="button" className="btn">
            Hover me
          </button>
          <span className="tooltip__label">Tooltip label</span>
        </span>
      </Section>
    </div>
  );
}

const meta = {
  title: "UI/Toggles",
  component: TogglesGallery,
} satisfies Meta<typeof TogglesGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
