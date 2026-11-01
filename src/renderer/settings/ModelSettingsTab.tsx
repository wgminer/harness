import { CHAT_PROVIDERS } from "../../shared/chatProviders";
import { SecretField } from "./SecretField";
import { SettingsField } from "./SettingsField";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";
import { SettingsTabPanel } from "./SettingsTabPanel";
import { useModelSettings } from "./useModelSettings";

export function ModelSettingsTab({ onSaved }: { onSaved?: () => void }) {
  const model = useModelSettings({ onSaved });
  const definition = CHAT_PROVIDERS.find((p) => p.id === model.provider);
  const claude = CHAT_PROVIDERS.find((p) => p.id === "claude");

  if (!model.loaded) return <SettingsTabPanel id="model">{null}</SettingsTabPanel>;

  return (
    <SettingsTabPanel id="model">
      <SettingsGroup
        title="Provider"
        description="Runs chat, titles, transcript cleanup, and the note and task helpers. Images use OpenAI or Google either way."
      >
        <div className="settings-section" data-testid="settings-chat-provider">
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
        </div>
        {definition ? <SettingsHint>{definition.description}</SettingsHint> : null}
      </SettingsGroup>

      {model.provider === "claude" ? (
        <SettingsGroup
          title="Anthropic"
          description={
            <>
              Chat uses {claude?.chatModel}; titles and cleanup use {claude?.smallModel}. Get a key at{" "}
              <a href="https://console.anthropic.com" target="_blank" rel="noreferrer noopener">
                console.anthropic.com
              </a>
              .
            </>
          }
        >
          <SettingsField label="API key" htmlFor="settings-anthropic-key">
            <SecretField
              id="settings-anthropic-key"
              testId="settings-anthropic-key"
              value={model.anthropicApiKey}
              onChange={(e) => model.setAnthropicApiKey(e.target.value)}
              onBlur={() => void model.saveAnthropicApiKey()}
              ariaLabel="Anthropic API key"
            />
          </SettingsField>
        </SettingsGroup>
      ) : null}

      {model.provider === "local" ? (
        <SettingsGroup
          title="Local server"
          description="Any OpenAI-compatible server: Ollama, or LM Studio at http://localhost:1234/v1."
        >
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
          <SettingsHint>
            Use the name the server lists, and pull it first (for Ollama, ollama pull {model.localModel}).
            Ollama gives models a 4,096-token context by default, which Harness's tools can overflow; start
            Ollama with OLLAMA_CONTEXT_LENGTH=16384 or higher.
          </SettingsHint>
          <SettingsHint>
            Thinking models such as qwen3 reason before every reply, so titles and transcript cleanup can
            take half a minute. An instruct model is quicker.
          </SettingsHint>
        </SettingsGroup>
      ) : null}
    </SettingsTabPanel>
  );
}
