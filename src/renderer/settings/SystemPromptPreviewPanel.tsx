import { useCallback, useEffect, useState } from "react";
import type { SystemPromptPreview } from "../../shared/types";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";

type PreviewPlatform = "desktop" | "ios";

export function SystemPromptPreviewPanel({
  collapsible = false,
  defaultOpen = true,
}: {
  collapsible?: boolean;
  defaultOpen?: boolean;
} = {}) {
  const [platform, setPlatform] = useState<PreviewPlatform>("desktop");
  const [preview, setPreview] = useState<SystemPromptPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async (nextPlatform: PreviewPlatform) => {
    if (!window.harness?.settings?.getSystemPromptPreview) return;
    setLoading(true);
    setError(null);
    try {
      const result = await window.harness.settings.getSystemPromptPreview(nextPlatform);
      setPreview(result);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Could not load system prompt preview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreview(platform);
  }, [loadPreview, platform]);

  return (
    <SettingsGroup
      title="System prompt"
      description="Read-only preview of the synced chat system prompt. Shared rules and formatting are identical on both platforms; each overlay adds platform identity and tools."
      collapsible={collapsible}
      defaultOpen={defaultOpen}
    >
      <div
        className="settings-system-prompt-toggle"
        role="tablist"
        aria-label="System prompt platform preview"
      >
        <button
          type="button"
          role="tab"
          className={`btn settings-system-prompt-toggle__btn${platform === "desktop" ? " settings-system-prompt-toggle__btn--active" : ""}`}
          aria-selected={platform === "desktop"}
          data-testid="settings-system-prompt-desktop"
          onClick={() => setPlatform("desktop")}
        >
          Desktop
        </button>
        <button
          type="button"
          role="tab"
          className={`btn settings-system-prompt-toggle__btn${platform === "ios" ? " settings-system-prompt-toggle__btn--active" : ""}`}
          aria-selected={platform === "ios"}
          data-testid="settings-system-prompt-ios"
          onClick={() => setPlatform("ios")}
        >
          iOS
        </button>
      </div>

      {loading && <SettingsHint flush>Loading preview…</SettingsHint>}
      {error && <SettingsHint flush>{error}</SettingsHint>}

      {preview && !loading && (
        <>
          <label className="app-modal-field">
            <span className="app-modal-field__label">Static prompt (shared + {platform})</span>
            <textarea
              readOnly
              value={preview.staticPrompt}
              className="app-modal-input app-modal-input--multiline settings-system-prompt-preview"
              rows={14}
              aria-label={`Static system prompt for ${platform}`}
              data-testid="settings-system-prompt-static"
            />
          </label>

          <SettingsHint flush>
            At send time, all stored memory facts (sorted by key), recent conversations, and temporal
            context append below the static prompt.
            {preview.selectedFacts.length > 0
              ? ` ${preview.selectedFacts.length} fact${preview.selectedFacts.length === 1 ? "" : "s"} would inject now.`
              : " No facts stored yet."}
          </SettingsHint>

          {preview.memoryBlock && (
            <label className="app-modal-field">
              <span className="app-modal-field__label">Memory block (appended at send)</span>
              <textarea
                readOnly
                value={preview.memoryBlock}
                className="app-modal-input app-modal-input--multiline settings-system-prompt-preview"
                rows={6}
                aria-label="Memory block appended to system prompt"
                data-testid="settings-system-prompt-memory"
              />
            </label>
          )}

          {preview.recentConversationsBlock && (
            <label className="app-modal-field">
              <span className="app-modal-field__label">Recent conversations (appended at send)</span>
              <textarea
                readOnly
                value={preview.recentConversationsBlock}
                className="app-modal-input app-modal-input--multiline settings-system-prompt-preview"
                rows={8}
                aria-label="Recent conversations block appended to system prompt"
                data-testid="settings-system-prompt-recent"
              />
            </label>
          )}

          <label className="app-modal-field">
            <span className="app-modal-field__label">Temporal context (appended at send)</span>
            <textarea
              readOnly
              value={preview.temporalContext}
              className="app-modal-input app-modal-input--multiline settings-system-prompt-preview"
              rows={4}
              aria-label="Temporal context appended to system prompt"
              data-testid="settings-system-prompt-temporal"
            />
          </label>

          <label className="app-modal-field">
            <span className="app-modal-field__label">Full assembled prompt (as sent to the model)</span>
            <textarea
              readOnly
              value={preview.assembledPrompt}
              className="app-modal-input app-modal-input--multiline settings-system-prompt-preview"
              rows={16}
              aria-label="Full assembled system prompt"
              data-testid="settings-system-prompt-assembled"
            />
          </label>
        </>
      )}
    </SettingsGroup>
  );
}
