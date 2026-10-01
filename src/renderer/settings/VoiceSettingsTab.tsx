import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { settingsSection } from "../../shared/settingsPage";
import { DEFAULT_SETTINGS } from "../../shared/types";
import { Modal } from "../ui/Modal";
import { RecentRecordingsSection } from "./RecentRecordingsSection";
import { SettingsActions } from "./SettingsActions";
import { SettingsEntryRow } from "./SettingsEntryRow";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";
import { SettingsSubsection } from "./SettingsSubsection";
import { SettingsSwitch } from "./SettingsSwitch";
import { SettingsTabPanel } from "./SettingsTabPanel";

const D = DEFAULT_SETTINGS;

export interface VoiceSettingsTabProps {
  cleanupEnabled: boolean;
  setCleanupEnabled: (value: boolean) => void;
  cleanupPrompt: string;
  setCleanupPrompt: (value: string) => void;
  transcriptGlossary: string[];
  setTranscriptGlossary: Dispatch<SetStateAction<string[]>>;
  /** True when OpenAI key is known configured (before secrets hydrate). */
  openAIConfigured: boolean;
  secretsLoaded: boolean;
  apiKey: string;
  /** Dictation behavior group, rendered above Cleanup. */
  children?: ReactNode;
}

export function VoiceSettingsTab({
  cleanupEnabled,
  setCleanupEnabled,
  cleanupPrompt,
  setCleanupPrompt,
  transcriptGlossary,
  setTranscriptGlossary,
  openAIConfigured,
  secretsLoaded,
  apiKey,
  children,
}: VoiceSettingsTabProps) {
  const [cleanupPromptDraft, setCleanupPromptDraft] = useState(cleanupPrompt);
  const [cleanupPromptModalOpen, setCleanupPromptModalOpen] = useState(false);
  const [glossaryModalOpen, setGlossaryModalOpen] = useState(false);
  const [editingGlossaryTerm, setEditingGlossaryTerm] = useState<string | null>(null);
  const [glossaryDraft, setGlossaryDraft] = useState("");

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

  const closeGlossaryModal = () => {
    setGlossaryModalOpen(false);
    setEditingGlossaryTerm(null);
    setGlossaryDraft("");
  };

  const openAddGlossaryModal = () => {
    setEditingGlossaryTerm(null);
    setGlossaryDraft("");
    setGlossaryModalOpen(true);
  };

  const openEditGlossaryModal = (term: string) => {
    setEditingGlossaryTerm(term);
    setGlossaryDraft(term);
    setGlossaryModalOpen(true);
  };

  const saveGlossaryTerm = () => {
    const term = glossaryDraft.trim();
    if (!term) return;
    const filtered = transcriptGlossary.filter((entry) => {
      if (editingGlossaryTerm && entry === editingGlossaryTerm) return false;
      return entry.toLowerCase() !== term.toLowerCase();
    });
    setTranscriptGlossary([...filtered, term]);
    closeGlossaryModal();
  };

  const deleteGlossaryTerm = (term: string) => {
    setTranscriptGlossary((prev) => prev.filter((entry) => entry !== term));
  };

  return (
    <>
      <SettingsTabPanel id="voice">
        {children}
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
              Cleanup needs an OpenAI API key in {settingsSection("Accounts")}.
            </SettingsHint>
          ) : null}

          <SettingsSubsection
            title="Preferred spellings"
            description={
              cleanupEnabled
                ? "Names and terms cleanup should prefer, including close variants."
                : "Turn on cleanup to apply these names and terms, including close variants."
            }
          >
            {transcriptGlossary.length === 0 ? (
              <SettingsHint flush>No preferred spellings yet.</SettingsHint>
            ) : (
              <div className="settings-entry-list">
                {transcriptGlossary.map((term) => (
                  <SettingsEntryRow
                    key={term}
                    title={term}
                    onEdit={() => openEditGlossaryModal(term)}
                    onDelete={() => deleteGlossaryTerm(term)}
                    editAriaLabel={`Edit preferred spelling ${term}`}
                    deleteAriaLabel={`Remove preferred spelling ${term}`}
                  />
                ))}
              </div>
            )}
            <SettingsActions>
              <button type="button" className="btn" onClick={openAddGlossaryModal}>
                Add spelling
              </button>
            </SettingsActions>
          </SettingsSubsection>
        </SettingsGroup>

        <RecentRecordingsSection />
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
        open={glossaryModalOpen}
        onClose={closeGlossaryModal}
        title={editingGlossaryTerm ? "Edit preferred spelling" : "Add preferred spelling"}
        footer={
          <>
            <button type="button" className="btn" onClick={closeGlossaryModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveGlossaryTerm}
              disabled={!glossaryDraft.trim()}
            >
              {editingGlossaryTerm ? "Update" : "Save"}
            </button>
          </>
        }
      >
        <label className="app-modal-field">
          <span className="app-modal-field__label">Name or term</span>
          <input
            type="text"
            value={glossaryDraft}
            onChange={(e) => setGlossaryDraft(e.target.value)}
            className="app-modal-input"
            autoComplete="off"
          />
        </label>
      </Modal>
    </>
  );
}
