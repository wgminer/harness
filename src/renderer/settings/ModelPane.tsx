import { CHAT_PROVIDERS } from "../../shared/chatProviders";
import { SecretField } from "./SecretField";
import { SettingsField } from "./SettingsField";
import { SettingsPane, SettingsPanelBlock, SettingsRow } from "./SettingsPanel";
import type { useModelSettings } from "./useModelSettings";

/** Which provider runs chat, titles, cleanup and the helpers, plus what that provider needs. */
export function ModelPane({ model }: { model: ReturnType<typeof useModelSettings> }) {
  const definition = CHAT_PROVIDERS.find((p) => p.id === model.provider);
  const claude = CHAT_PROVIDERS.find((p) => p.id === "claude");

  return (
    <SettingsPane
      title="Chat model"
      description="Runs chat, titles, transcript cleanup, and the note and task helpers. Images use OpenAI or Google either way."
    >
      <SettingsRow label="Provider" description={definition?.description} testId="settings-chat-provider">
        <div className="settings-system-prompt-toggle" role="radiogroup" aria-label="Provider">
          {CHAT_PROVIDERS.map((provider) => {
            const selected = model.provider === provider.id;
            return (
              <button
                key={provider.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`settings-system-prompt-toggle__btn${
                  selected ? " settings-system-prompt-toggle__btn--active" : ""
                }`}
                onClick={() => model.selectProvider(provider.id)}
              >
                {provider.label}
              </button>
            );
          })}
        </div>
      </SettingsRow>

      {model.provider === "claude" ? (
        <SettingsPanelBlock>
          <SettingsField label="Anthropic API key" htmlFor="settings-anthropic-key">
            <SecretField
              id="settings-anthropic-key"
              testId="settings-anthropic-key"
              value={model.anthropicApiKey}
              onChange={(e) => model.setAnthropicApiKey(e.target.value)}
              onBlur={() => void model.saveAnthropicApiKey()}
              ariaLabel="Anthropic API key"
            />
          </SettingsField>
          <p className="settings-row__desc">
            Chat uses {claude?.chatModel}; titles and cleanup use {claude?.smallModel}. Get a key at{" "}
            <a href="https://console.anthropic.com" target="_blank" rel="noreferrer noopener">
              console.anthropic.com
            </a>
            .
          </p>
        </SettingsPanelBlock>
      ) : null}

      {model.provider === "local" ? (
        <SettingsPanelBlock>
          <div className="settings-field-grid">
            <SettingsField label="Server URL" htmlFor="settings-local-base-url">
              <input
                id="settings-local-base-url"
                type="text"
                value={model.localBaseUrl}
                onChange={(e) => model.setLocalBaseUrl(e.target.value)}
                onBlur={model.saveLocal}
                autoComplete="off"
                spellCheck={false}
              />
            </SettingsField>
            <SettingsField label="Model" htmlFor="settings-local-model">
              <input
                id="settings-local-model"
                type="text"
                value={model.localModel}
                onChange={(e) => model.setLocalModel(e.target.value)}
                onBlur={model.saveLocal}
                autoComplete="off"
                spellCheck={false}
              />
            </SettingsField>
          </div>
          <p className="settings-row__desc">
            Any OpenAI-compatible server: Ollama, or LM Studio at http://localhost:1234/v1. Use the name
            the server lists, and pull it first (for Ollama, ollama pull {model.localModel}). Ollama gives
            models a 4,096-token context by default, which Harness's tools can overflow; start Ollama with
            OLLAMA_CONTEXT_LENGTH=16384 or higher.
          </p>
          <p className="settings-row__desc">
            Thinking models such as qwen3 reason before every reply, so titles and transcript cleanup can
            take half a minute. An instruct model is quicker.
          </p>
        </SettingsPanelBlock>
      ) : null}
    </SettingsPane>
  );
}
