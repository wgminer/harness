import { useState, type Dispatch, type SetStateAction } from "react";
import { settingsSection } from "../../shared/settingsPage";
import { DEFAULT_SETTINGS } from "../../shared/types";
import type { TranscriptDictionaryEntry } from "../../shared/types";
import { Modal } from "../Modal";
import { SettingsActions } from "./SettingsActions";
import { SettingsEntryRow } from "./SettingsEntryRow";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";
import { SettingsSwitch } from "./SettingsSwitch";
import { SettingsTabPanel } from "./SettingsTabPanel";

const D = DEFAULT_SETTINGS;

export interface VoiceSettingsTabProps {
  cleanupEnabled: boolean;
  setCleanupEnabled: (value: boolean) => void;
  cleanupPrompt: string;
  setCleanupPrompt: (value: string) => void;
  transcriptDictionary: TranscriptDictionaryEntry[];
  setTranscriptDictionary: Dispatch<SetStateAction<TranscriptDictionaryEntry[]>>;
  /** True when OpenAI key is known configured (before secrets hydrate). */
  openAIConfigured: boolean;
  secretsLoaded: boolean;
  apiKey: string;
}

export function VoiceSettingsTab({
  cleanupEnabled,
  setCleanupEnabled,
  cleanupPrompt,
  setCleanupPrompt,
  transcriptDictionary,
  setTranscriptDictionary,
  openAIConfigured,
  secretsLoaded,
  apiKey,
}: VoiceSettingsTabProps) {
  const [cleanupPromptDraft, setCleanupPromptDraft] = useState(cleanupPrompt);
  const [cleanupPromptModalOpen, setCleanupPromptModalOpen] = useState(false);
  const [dictionaryModalOpen, setDictionaryModalOpen] = useState(false);
  const [editingDictionaryFrom, setEditingDictionaryFrom] = useState<string | null>(null);
  const [dictionaryFromDraft, setDictionaryFromDraft] = useState("");
  const [dictionaryToDraft, setDictionaryToDraft] = useState("");

  const openCleanupPromptModal = () => {
    setCleanupPromptDraft(cleanupPrompt);
    setCleanupPromptModalOpen(true);
  };

  const closeCleanupPromptModal = () => {
    setCleanupPromptDraft(cleanupPrompt);
    setCleanupPromptModalOpen(false);
  };

  const saveCleanupPrompt = () => {
    const trimmed = cleanupPromptDraft.trim();
    if (!trimmed) return;
    setCleanupPrompt(trimmed);
    setCleanupPromptModalOpen(false);
  };

  const resetCleanupPromptDraft = () => {
    setCleanupPromptDraft(D.transcription?.cleanup?.prompt ?? "");
  };

  const closeDictionaryModal = () => {
    setDictionaryModalOpen(false);
    setEditingDictionaryFrom(null);
    setDictionaryFromDraft("");
    setDictionaryToDraft("");
  };

  const openAddDictionaryModal = () => {
    setEditingDictionaryFrom(null);
    setDictionaryFromDraft("");
    setDictionaryToDraft("");
    setDictionaryModalOpen(true);
  };

  const openEditDictionaryModal = (entry: TranscriptDictionaryEntry) => {
    setEditingDictionaryFrom(entry.from);
    setDictionaryFromDraft(entry.from);
    setDictionaryToDraft(entry.to);
    setDictionaryModalOpen(true);
  };

  const saveDictionaryEntry = () => {
    const from = dictionaryFromDraft.trim();
    if (!from) return;
    const to = dictionaryToDraft.trim();
    const filtered = transcriptDictionary.filter((entry) => {
      if (editingDictionaryFrom && entry.from === editingDictionaryFrom) return false;
      return entry.from.toLowerCase() !== from.toLowerCase();
    });
    setTranscriptDictionary([...filtered, { from, to }]);
    closeDictionaryModal();
  };

  const deleteDictionaryEntry = (from: string) => {
    setTranscriptDictionary((prev) => prev.filter((entry) => entry.from !== from));
  };

  return (
    <>
      <SettingsTabPanel id="voice">
        <SettingsGroup title="Cleanup">
          <SettingsSwitch
            id="transcriptCleanupToggle"
            label="Clean up transcripts"
            checked={cleanupEnabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              setCleanupEnabled(enabled);
              if (!enabled) setCleanupPromptModalOpen(false);
            }}
          />
          {cleanupEnabled ? (
            <SettingsActions>
              <button type="button" className="btn" onClick={openCleanupPromptModal}>
                Edit Prompt
              </button>
            </SettingsActions>
          ) : null}
          {cleanupEnabled &&
          !(secretsLoaded ? apiKey.trim().length > 0 : openAIConfigured) ? (
            <SettingsHint>
              Cleanup needs an OpenAI API key in {settingsSection("Data")}.
            </SettingsHint>
          ) : null}
        </SettingsGroup>

        <SettingsGroup title="Transcript corrections">
          {transcriptDictionary.length === 0 ? (
            <SettingsHint flush>No corrections yet.</SettingsHint>
          ) : (
            <div className="settings-entry-list">
              {transcriptDictionary.map((entry) => (
                <SettingsEntryRow
                  key={entry.from}
                  title={entry.from}
                  detail={entry.to}
                  onEdit={() => openEditDictionaryModal(entry)}
                  onDelete={() => deleteDictionaryEntry(entry.from)}
                  editAriaLabel={`Edit transcript correction ${entry.from}`}
                  deleteAriaLabel={`Remove transcript correction ${entry.from}`}
                />
              ))}
            </div>
          )}
          <SettingsActions>
            <button type="button" className="btn" onClick={openAddDictionaryModal}>
              Add Correction
            </button>
          </SettingsActions>
        </SettingsGroup>
      </SettingsTabPanel>

      <Modal
        open={cleanupPromptModalOpen}
        onClose={closeCleanupPromptModal}
        title="Automatic text cleanup prompt"
        data-testid="settings-cleanup-prompt-modal"
        footer={
          <>
            <button type="button" className="btn" onClick={closeCleanupPromptModal}>
              Cancel
            </button>
            <button type="button" className="btn btn-outline" onClick={resetCleanupPromptDraft}>
              Reset to Default
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveCleanupPrompt}
              disabled={!cleanupPromptDraft.trim()}
            >
              Save
            </button>
          </>
        }
      >
        <div className="app-modal-stack">
          <label className="app-modal-field">
            <span className="app-modal-field__label">Prompt text</span>
            <textarea
              value={cleanupPromptDraft}
              onChange={(e) => setCleanupPromptDraft(e.target.value)}
              className="app-modal-input app-modal-input--multiline"
              rows={6}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={dictionaryModalOpen}
        onClose={closeDictionaryModal}
        title={editingDictionaryFrom ? "Edit transcript correction" : "Add transcript correction"}
        footer={
          <>
            <button type="button" className="btn" onClick={closeDictionaryModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveDictionaryEntry}
              disabled={!dictionaryFromDraft.trim()}
            >
              {editingDictionaryFrom ? "Update" : "Save"}
            </button>
          </>
        }
      >
        <div className="app-modal-stack">
          <label className="app-modal-field">
            <span className="app-modal-field__label">Heard as</span>
            <input
              type="text"
              value={dictionaryFromDraft}
              onChange={(e) => setDictionaryFromDraft(e.target.value)}
              className="app-modal-input"
              autoComplete="off"
            />
          </label>
          <label className="app-modal-field">
            <span className="app-modal-field__label">Replace with</span>
            <input
              type="text"
              value={dictionaryToDraft}
              onChange={(e) => setDictionaryToDraft(e.target.value)}
              className="app-modal-input"
              autoComplete="off"
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
