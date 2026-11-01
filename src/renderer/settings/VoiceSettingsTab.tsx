import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { GlobalRecordingStatus } from "../../shared/desktopAPI";
import { settingsSection } from "../../shared/settingsPage";
import { DEFAULT_SETTINGS } from "../../shared/types";
import {
  TRANSCRIPTION_ENGINES,
  type TranscriptionEngineId,
  type TranscriptionEngineStatus,
} from "../../shared/transcriptionEngines";
import { Modal } from "../ui/Modal";
import { DictationTimingBody } from "./DictationTimingBody";
import { ExternalButtonRows } from "./ExternalButtonRows";
import { RecentRecordingsRows } from "./RecentRecordingsRows";
import {
  SettingsDisclosure,
  SettingsPane,
  SettingsPanelBlock,
  SettingsPill,
  SettingsRow,
  SettingsSwitchRow,
} from "./SettingsPanel";
import { SettingsTabPanel } from "./SettingsTabPanel";
import { SpellingTagInput } from "./SpellingTagInput";
import { VoicePermissionRows } from "./VoicePermissionRows";
import { VoicePipeline } from "./VoicePipeline";

const D = DEFAULT_SETTINGS;

const ENGINE_STATUS_POLL_MS = 2000;

const SECTION = {
  trigger: "settings-voice-trigger",
  transcribe: "settings-voice-transcribe",
  cleanup: "settings-voice-cleanup",
  deliver: "settings-voice-deliver",
} as const;

/** Parakeet model readiness; starts the one-time download when models are missing. */
function useEngineStatus(engine: TranscriptionEngineId) {
  const [status, setStatus] = useState<TranscriptionEngineStatus | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (engine === "apple") {
      setStatus(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const api = window.harness.recording;
    const poll = async () => {
      try {
        let next = await api.transcriptionEngineStatus(engine);
        if (next.state === "missing") {
          await api.prepareTranscriptionEngine(engine);
          next = { state: "downloading" };
        }
        if (cancelled) return;
        setStatus(next);
        if (next.state === "downloading") timer = setTimeout(poll, ENGINE_STATUS_POLL_MS);
      } catch (err) {
        if (!cancelled) setStatus({ state: "failed", error: String(err) });
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [engine, attempt]);

  const retry = async () => {
    await window.harness.recording.prepareTranscriptionEngine(engine);
    setAttempt((n) => n + 1);
  };

  return { status, retry };
}

export interface VoiceSettingsTabProps {
  isMac: boolean;
  globalFnHotkey: boolean;
  setGlobalFnHotkey: (value: boolean) => void;
  accessibilityTrusted: boolean | null;
  setAccessibilityTrusted: (value: boolean | null) => void;
  globalRecordingStatus: GlobalRecordingStatus | null;
  refreshGlobalRecordingStatus: () => Promise<void>;
  transcriptionEngine: TranscriptionEngineId;
  setTranscriptionEngine: (value: TranscriptionEngineId) => void;
  cleanupEnabled: boolean;
  setCleanupEnabled: (value: boolean) => void;
  cleanupPrompt: string;
  setCleanupPrompt: (value: string) => void;
  transcriptGlossary: string[];
  setTranscriptGlossary: Dispatch<SetStateAction<string[]>>;
  autoSend: boolean;
  setAutoSend: (value: boolean) => void;
  bringToFrontOnBackgroundDictation: boolean;
  setBringToFrontOnBackgroundDictation: (value: boolean) => void;
  /** True when OpenAI key is known configured (before secrets hydrate). */
  openAIConfigured: boolean;
  secretsLoaded: boolean;
  apiKey: string;
}

export function VoiceSettingsTab({
  isMac,
  globalFnHotkey,
  setGlobalFnHotkey,
  accessibilityTrusted,
  setAccessibilityTrusted,
  globalRecordingStatus,
  refreshGlobalRecordingStatus,
  transcriptionEngine,
  setTranscriptionEngine,
  cleanupEnabled,
  setCleanupEnabled,
  cleanupPrompt,
  setCleanupPrompt,
  transcriptGlossary,
  setTranscriptGlossary,
  autoSend,
  setAutoSend,
  bringToFrontOnBackgroundDictation,
  setBringToFrontOnBackgroundDictation,
  openAIConfigured,
  secretsLoaded,
  apiKey,
}: VoiceSettingsTabProps) {
  const [cleanupPromptDraft, setCleanupPromptDraft] = useState(cleanupPrompt);
  const [cleanupPromptModalOpen, setCleanupPromptModalOpen] = useState(false);
  const { status: engineStatus, retry: retryEngineDownload } = useEngineStatus(transcriptionEngine);
  const engineLabel = TRANSCRIPTION_ENGINES.find((e) => e.id === transcriptionEngine)?.label ?? "";
  const fnActive = isMac && globalFnHotkey;
  const hasOpenAIKey = secretsLoaded ? apiKey.trim().length > 0 : openAIConfigured;

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

  const spellingCount = transcriptGlossary.length;

  return (
    <>
      <SettingsTabPanel id="voice">
        <VoicePipeline
          steps={[
            {
              targetId: SECTION.trigger,
              label: fnActive ? "You hold Fn" : "You press record",
              value: fnActive ? "Anywhere on your Mac" : "In Harness",
            },
            {
              targetId: SECTION.transcribe,
              label: "Speech becomes text",
              value: engineStatus?.state === "downloading" ? `${engineLabel}, downloading` : engineLabel,
            },
            {
              targetId: SECTION.cleanup,
              label: "Text gets cleaned",
              value: !cleanupEnabled
                ? "Off"
                : spellingCount > 0
                  ? `${spellingCount} preferred spelling${spellingCount === 1 ? "" : "s"}`
                  : "On",
              off: !cleanupEnabled,
            },
            {
              targetId: SECTION.deliver,
              label: "It lands",
              value: autoSend ? "Sent right away" : "Waits in the composer",
            },
          ]}
        />

        <SettingsPane title="Trigger" id={SECTION.trigger}>
          {isMac ? (
            <>
              <SettingsSwitchRow
                id="globalFnHotkeyToggle"
                testId="settings-global-fn-hotkey"
                label="Hold Fn to dictate"
                description="Works in any app. Release to stop."
                checked={globalFnHotkey}
                onChange={(e) => setGlobalFnHotkey(e.target.checked)}
              />
              {globalFnHotkey ? (
                <VoicePermissionRows
                  accessibilityTrusted={accessibilityTrusted}
                  setAccessibilityTrusted={setAccessibilityTrusted}
                  globalRecordingStatus={globalRecordingStatus}
                  refreshGlobalRecordingStatus={refreshGlobalRecordingStatus}
                />
              ) : null}
              <ExternalButtonRows />
            </>
          ) : (
            <SettingsRow label="Mic button" description="Press the mic in the composer to start and stop." />
          )}
        </SettingsPane>

        <SettingsPane title="Transcribe" id={SECTION.transcribe}>
          <SettingsPanelBlock>
            <div
              className="settings-engine-cards"
              role="radiogroup"
              aria-label="Transcription engine"
              data-testid="settings-transcription-engine"
            >
              {TRANSCRIPTION_ENGINES.map((engine) => {
                const selected = transcriptionEngine === engine.id;
                return (
                  <button
                    key={engine.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`settings-engine-card${selected ? " settings-engine-card--selected" : ""}`}
                    onClick={() => setTranscriptionEngine(engine.id)}
                  >
                    <span className="settings-engine-card__head">
                      {engine.label}
                      <span className="settings-engine-card__radio" aria-hidden />
                    </span>
                    <span className="settings-row__desc">{engine.description}</span>
                  </button>
                );
              })}
            </div>
          </SettingsPanelBlock>
          {engineStatus?.state === "downloading" ? (
            <SettingsRow
              label="Downloading the model"
              description="Apple Speech is used until it's ready."
              leading={<Loader2 size={16} className="voice-spinner" aria-hidden />}
            />
          ) : null}
          {engineStatus?.state === "failed" ? (
            <SettingsRow
              label="The model didn't download"
              description={`${engineStatus.error ? `${engineStatus.error}. ` : ""}Apple Speech is used instead.`}
            >
              <button type="button" className="btn btn-sm" onClick={() => void retryEngineDownload()}>
                Retry download
              </button>
            </SettingsRow>
          ) : null}
          {engineStatus?.state === "ready" ? (
            <SettingsRow label="Model" description="Downloaded and ready on this Mac.">
              <SettingsPill tone="ok">Ready</SettingsPill>
            </SettingsRow>
          ) : null}
        </SettingsPane>

        <SettingsPane title="Clean up" id={SECTION.cleanup}>
          <SettingsSwitchRow
            id="transcriptCleanupToggle"
            label="Clean up transcripts"
            description="Removes filler words and fixes punctuation with OpenAI."
            checked={cleanupEnabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              setCleanupEnabled(enabled);
              if (!enabled) setCleanupPromptModalOpen(false);
            }}
          />
          {cleanupEnabled && !hasOpenAIKey ? (
            <SettingsRow
              label="Needs an OpenAI key"
              description={`Add one in ${settingsSection("Connections")}.`}
            />
          ) : null}
          {cleanupEnabled ? (
            <>
              <SettingsPanelBlock>
                <div className="settings-row__text">
                  <label className="settings-row__label" htmlFor="settings-spellings-input">
                    Preferred spellings
                  </label>
                  <span className="settings-row__desc">
                    Names and terms cleanup should prefer, including close variants.
                  </span>
                </div>
                <SpellingTagInput
                  id="settings-spellings-input"
                  terms={transcriptGlossary}
                  setTerms={setTranscriptGlossary}
                />
                <div className="settings-cleanup-example" aria-label="Example">
                  <div className="settings-cleanup-example__side">
                    <span className="settings-cleanup-example__label">Heard</span>
                    <span className="settings-cleanup-example__heard">
                      um, so ask cloud code to, uh, check the harness build
                    </span>
                  </div>
                  <ArrowRight size={14} className="settings-cleanup-example__arrow" aria-hidden />
                  <div className="settings-cleanup-example__side">
                    <span className="settings-cleanup-example__label">Cleaned</span>
                    <span className="settings-cleanup-example__clean">
                      Ask <mark>Claude Code</mark> to check the <mark>Harness</mark> build.
                    </span>
                  </div>
                </div>
              </SettingsPanelBlock>
              <SettingsRow label="Prompt" description="The instructions cleanup follows.">
                <button type="button" className="btn btn-sm" onClick={openCleanupPromptModal}>
                  Edit
                </button>
              </SettingsRow>
            </>
          ) : null}
        </SettingsPane>

        <SettingsPane title="Deliver" id={SECTION.deliver}>
          <SettingsSwitchRow
            id="autoSendToggle"
            testId="settings-auto-send"
            label="Send after dictation"
            description="Off leaves the text in the composer to edit first."
            checked={autoSend}
            onChange={(e) => setAutoSend(e.target.checked)}
          />
          <SettingsSwitchRow
            id="bringToFrontOnBackgroundDictationToggle"
            testId="settings-bring-to-front-background-dictation"
            label="Bring Harness forward"
            description="When you dictate from another app."
            checked={bringToFrontOnBackgroundDictation}
            onChange={(e) => setBringToFrontOnBackgroundDictation(e.target.checked)}
          />
        </SettingsPane>

        <SettingsPane
          title="Recordings"
          description="Audio is saved even when transcription fails. Retry sends a take through dictation again."
        >
          <RecentRecordingsRows />
          <SettingsDisclosure label="Dictation timing" description="How long each step took, last five.">
            <DictationTimingBody />
          </SettingsDisclosure>
        </SettingsPane>
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

    </>
  );
}
