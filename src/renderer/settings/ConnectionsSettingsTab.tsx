import { useState, type ReactNode } from "react";
import { GmailRows } from "./GmailRows";
import { ModelPane } from "./ModelPane";
import { SecretField } from "./SecretField";
import { SettingsPane, SettingsPanelBlock, SettingsPill, SettingsRow } from "./SettingsPanel";
import { SettingsTabPanel } from "./SettingsTabPanel";
import { useModelSettings } from "./useModelSettings";

interface ProviderKeyRowProps {
  id: string;
  name: string;
  monogram: string;
  description: ReactNode;
  required?: boolean;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  secretsLoaded: boolean;
}

/** One provider: its state, and the key field revealed on demand. */
function ProviderKeyRow({
  id,
  name,
  monogram,
  description,
  required = false,
  value,
  onChange,
  onCommit,
  secretsLoaded,
}: ProviderKeyRowProps) {
  const [editing, setEditing] = useState(false);
  const hasKey = value.trim().length > 0;
  const open = editing || (secretsLoaded && required && !hasKey);

  return (
    <>
      <SettingsRow
        label={name}
        description={description}
        leading={<span className="settings-monogram" aria-hidden>{monogram}</span>}
        testId={`settings-provider-${id}`}
      >
        {!secretsLoaded ? null : hasKey ? (
          <SettingsPill tone="ok">Key saved</SettingsPill>
        ) : (
          <SettingsPill tone={required ? "attention" : "idle"}>{required ? "Required" : "Optional"}</SettingsPill>
        )}
        {secretsLoaded && !(required && !hasKey) ? (
          <button
            type="button"
            className="btn btn-sm"
            aria-expanded={open}
            onClick={() => {
              if (editing) onCommit();
              setEditing((v) => !v);
            }}
          >
            {editing ? "Done" : hasKey ? "Replace" : "Add key"}
          </button>
        ) : null}
      </SettingsRow>
      {open ? (
        <SettingsPanelBlock>
          <SecretField
            id={`settings-${id}-key`}
            testId={`settings-${id}-key`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            ariaLabel={`${name} API key`}
            placeholder="Paste a key"
          />
        </SettingsPanelBlock>
      ) : null}
    </>
  );
}

export interface ConnectionsSettingsTabProps {
  apiKey: string;
  setApiKey: (value: string) => void;
  tavilyApiKey: string;
  setTavilyApiKey: (value: string) => void;
  googleApiKey: string;
  setGoogleApiKey: (value: string) => void;
  persistSettings: () => Promise<boolean>;
  secretsLoaded: boolean;
  /** After the provider or its settings save, so setup state can refresh. */
  onModelSaved?: () => void;
}

export function ConnectionsSettingsTab({
  apiKey,
  setApiKey,
  tavilyApiKey,
  setTavilyApiKey,
  googleApiKey,
  setGoogleApiKey,
  persistSettings,
  secretsLoaded,
  onModelSaved,
}: ConnectionsSettingsTabProps) {
  const commit = () => void persistSettings();
  const model = useModelSettings({ onSaved: onModelSaved });

  return (
    <SettingsTabPanel id="connections">
      {model.loaded ? <ModelPane model={model} /> : null}

      <SettingsPane title="Keys">
        <ProviderKeyRow
          id="openai"
          name="OpenAI"
          monogram="O"
          description="Chat, polish, transcript cleanup and memory import, when OpenAI is the provider."
          required={model.provider === "openai"}
          value={apiKey}
          onChange={setApiKey}
          onCommit={commit}
          secretsLoaded={secretsLoaded}
        />
        <ProviderKeyRow
          id="google"
          name="Google AI"
          monogram="G"
          description={
            <>
              Image generation. Without a key, images use OpenAI. Get one at{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener">
                aistudio.google.com
              </a>
              .
            </>
          }
          value={googleApiKey}
          onChange={setGoogleApiKey}
          onCommit={commit}
          secretsLoaded={secretsLoaded}
        />
      </SettingsPane>

      <SettingsPane title="Search and mail">
        <ProviderKeyRow
          id="tavily"
          name="Tavily"
          monogram="T"
          description={
            <>
              Web search in chat. Get a key at{" "}
              <a href="https://tavily.com" target="_blank" rel="noreferrer noopener">
                tavily.com
              </a>
              .
            </>
          }
          value={tavilyApiKey}
          onChange={setTavilyApiKey}
          onCommit={commit}
          secretsLoaded={secretsLoaded}
        />
        <GmailRows />
      </SettingsPane>
    </SettingsTabPanel>
  );
}
