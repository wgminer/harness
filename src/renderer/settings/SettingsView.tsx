import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { SETTINGS_PAGE_TITLE } from "../../shared/settingsPage";
import { SyncQrModal } from "./SyncQrModal";
import { CliInstallSection } from "./CliInstallSection";
import { ExternalButtonSettingsGroup } from "./ExternalButtonSettingsGroup";
import { FnShortcutControls } from "./FnShortcutControls";
import { SettingsSaveToast } from "./SettingsSaveToast";
import { WorkspaceHeader } from "../ui/WorkspaceHeader";
import { useSyncStatus } from "../hooks/useSyncStatus";
import {
  AccountsSettingsTab,
  SETTINGS_SYNC_SECTION_ID,
  SettingsField,
  SettingsGroup,
  SettingsSwitch,
  SettingsSwitchProvider,
  SettingsTabPanel,
  DataSettingsTab,
  AccentColorField,
  ThemeModeField,
  NotesTemplatesTab,
  VoiceSettingsTab,
} from "./index";
import type { SettingsTabId } from "./settingsNavConfig";
import { normalizeSettingsTab, SETTINGS_TABS } from "./settingsNavConfig";
import { shouldLoadSettingsSecrets } from "./settingsSessionCache";
import { useSettingsForm } from "./useSettingsForm";

interface SettingsViewProps {
  /** After ChatGPT import (new conversations in sidebar). */
  onImportComplete?: () => void;
  /** After sync pull/merge (sidebar list may have changed). */
  onSyncComplete?: () => void;
  /** Open a specific tab when the view mounts (e.g. from first-run setup). */
  initialTab?: SettingsTabId;
  /** Fires after debounced settings autosave completes. */
  onSettingsChanged?: () => void;
  /** When true, "New note" opens a windowed note instead of the main Editor. */
  openNoteInStickyWindow?: boolean;
  onOpenNoteInStickyWindowChange?: (value: boolean) => void;
  /** Known from app setup; used for Voice cleanup hint before secrets load. */
  openAIConfigured?: boolean;
}

export function SettingsView({
  onImportComplete,
  onSyncComplete,
  initialTab,
  onSettingsChanged,
  openNoteInStickyWindow = false,
  onOpenNoteInStickyWindowChange,
  openAIConfigured = false,
}: SettingsViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Record<SettingsTabId, HTMLButtonElement | null>>({
    general: null,
    notes: null,
    voice: null,
    accounts: null,
    data: null,
  });
  const [activeTab, setActiveTab] = useState<SettingsTabId>(normalizeSettingsTab(initialTab));
  const [syncQrOpen, setSyncQrOpen] = useState(false);
  const { visibleError: syncError, dismissError: dismissSyncError } = useSyncStatus();
  const [pendingSyncReview, setPendingSyncReview] = useState(false);

  const form = useSettingsForm({
    onSettingsChanged,
    wantsSecrets: shouldLoadSettingsSecrets(activeTab, syncQrOpen, false),
    pollRecordingStatus: activeTab === "voice",
  });
  const {
    apiKey, setApiKey, tavilyApiKey, setTavilyApiKey, googleApiKey, setGoogleApiKey,
    r2SecretAccessKey, setR2SecretAccessKey, r2AccountId, setR2AccountId, r2Bucket, setR2Bucket,
    r2Prefix, setR2Prefix, r2AccessKeyId, setR2AccessKeyId,
    cleanupEnabled, setCleanupEnabled, cleanupPrompt, setCleanupPrompt,
    transcriptGlossary, setTranscriptGlossary, transcriptionEngine, setTranscriptionEngine,
    noteTemplates, defaultNoteTemplateId, handleTemplatesChange,
    autoSend, setAutoSend, globalFnHotkey, setGlobalFnHotkey,
    bringToFrontOnBackgroundDictation, setBringToFrontOnBackgroundDictation,
    openToComposeOnLaunch, setOpenToComposeOnLaunch, selectionImageLookup, setSelectionImageLookup,
    accent, setAccent, appearanceTheme, setAppearanceTheme, weatherZip, setWeatherZip,
    saveStatus, secretsLoaded, switchAnimationsReady, persistSettings, registerDataRefresh,
    platform, isMac, accessibilityTrusted, setAccessibilityTrusted,
    globalRecordingStatus, refreshGlobalRecordingStatus,
  } = form;

  useEffect(() => {
    setActiveTab(normalizeSettingsTab(initialTab));
  }, [initialTab]);

  const switchTab = (id: SettingsTabId) => {
    setActiveTab(id);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "auto" });
    }
  };

  const reviewSyncError = () => {
    switchTab("accounts");
    setPendingSyncReview(true);
  };

  // Land on the Sync group and put the cursor in the first empty field.
  useEffect(() => {
    if (!pendingSyncReview || activeTab !== "accounts") return;
    setPendingSyncReview(false);
    const section = document.getElementById(SETTINGS_SYNC_SECTION_ID);
    if (!section) return;
    section.scrollIntoView({ block: "start" });
    const inputs = Array.from(section.querySelectorAll<HTMLInputElement>("input"));
    (inputs.find((input) => input.value.trim() === "") ?? inputs[0])?.focus({ preventScroll: true });
  }, [pendingSyncReview, activeTab]);

  const focusTab = (id: SettingsTabId) => {
    tabButtonRefs.current[id]?.focus();
  };

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, id: SettingsTabId) => {
    const idx = SETTINGS_TABS.findIndex((tab) => tab.id === id);
    if (idx < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = SETTINGS_TABS[(idx + 1) % SETTINGS_TABS.length].id;
      focusTab(next);
      switchTab(next);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = SETTINGS_TABS[(idx - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length].id;
      focusTab(prev);
      switchTab(prev);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusTab(SETTINGS_TABS[0].id);
      switchTab(SETTINGS_TABS[0].id);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      const last = SETTINGS_TABS[SETTINGS_TABS.length - 1].id;
      focusTab(last);
      switchTab(last);
    }
  };

  return (
    <div className="workspace-page settings-page">
      <div ref={scrollRef} className="workspace-scroll settings-scroll">
        <WorkspaceHeader title={SETTINGS_PAGE_TITLE}>
          <div
            className="settings-tabs settings-tabs--header"
            role="tablist"
            aria-label={`${SETTINGS_PAGE_TITLE} sections`}
          >
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                ref={(el) => {
                  tabButtonRefs.current[tab.id] = el;
                }}
                id={`settings-tab-${tab.id}`}
                type="button"
                role="tab"
                className={`settings-tab${activeTab === tab.id ? " settings-tab--active" : ""}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`settings-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => switchTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </WorkspaceHeader>
        <SettingsSwitchProvider animationsReady={switchAnimationsReady}>
        <div className="workspace-content settings-content">
          {syncError && activeTab !== "accounts" ? (
            <div className="settings-banner settings-banner--error" role="alert">
              <div className="settings-banner__text">
                <strong>Sync failed</strong>
                <span>{syncError}</span>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={dismissSyncError}>
                Dismiss
              </button>
              <button type="button" className="btn btn-sm" onClick={reviewSyncError}>
                Review
              </button>
            </div>
          ) : null}
          {activeTab === "general" && <SettingsTabPanel id="general">
            <SettingsGroup
              title="Appearance"
              description="Dark chrome, or a shell tinted by the local hour. Accent colors controls and focus."
            >
              <ThemeModeField value={appearanceTheme} onChange={setAppearanceTheme} />
              <AccentColorField value={accent} onChange={setAccent} />
            </SettingsGroup>

            <SettingsGroup title="Behavior">
              <SettingsSwitch
                id="openToComposeOnLaunchToggle"
                testId="settings-open-to-compose-on-launch"
                label="Open to compose on launch"
                checked={openToComposeOnLaunch}
                onChange={(e) => setOpenToComposeOnLaunch(e.target.checked)}
              />
              <SettingsSwitch
                id="selectionImageLookupToggle"
                testId="settings-selection-image-lookup"
                label="Look up images on selection"
                checked={selectionImageLookup}
                onChange={(e) => setSelectionImageLookup(e.target.checked)}
              />
            </SettingsGroup>

            <SettingsGroup
              title="Weather"
              description="US ZIP for the temperature shown on the compose screen. Open-Meteo, no API key."
            >
              <SettingsField label="Default ZIP" htmlFor="settings-weather-zip">
                <input
                  id="settings-weather-zip"
                  data-testid="settings-weather-zip"
                  type="text"
                  value={weatherZip}
                  onChange={(e) => setWeatherZip(e.target.value)}
                  placeholder="12528"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  spellCheck={false}
                  maxLength={5}
                />
              </SettingsField>
            </SettingsGroup>

            {isMac ? <CliInstallSection /> : null}
          </SettingsTabPanel>}

          {activeTab === "notes" && (
            <NotesTemplatesTab
              noteTemplates={noteTemplates}
              defaultNoteTemplateId={defaultNoteTemplateId}
              onTemplatesChange={handleTemplatesChange}
            >
              <SettingsGroup title="Windows">
                <SettingsSwitch
                  id="openNoteInStickyWindowToggle"
                  testId="settings-open-note-in-window"
                  label="Open new notes in a window"
                  checked={openNoteInStickyWindow}
                  onChange={(e) => onOpenNoteInStickyWindowChange?.(e.target.checked)}
                />
              </SettingsGroup>
            </NotesTemplatesTab>
          )}

          {activeTab === "voice" && (
            <VoiceSettingsTab
              cleanupEnabled={cleanupEnabled}
              setCleanupEnabled={setCleanupEnabled}
              cleanupPrompt={cleanupPrompt}
              setCleanupPrompt={setCleanupPrompt}
              transcriptGlossary={transcriptGlossary}
              setTranscriptGlossary={setTranscriptGlossary}
              transcriptionEngine={transcriptionEngine}
              setTranscriptionEngine={setTranscriptionEngine}
              openAIConfigured={openAIConfigured}
              secretsLoaded={secretsLoaded}
              apiKey={apiKey}
            >
              <SettingsGroup title="Dictation">
                <SettingsSwitch
                  id="autoSendToggle"
                  testId="settings-auto-send"
                  label="Send after dictation"
                  checked={autoSend}
                  onChange={(e) => setAutoSend(e.target.checked)}
                />
                <SettingsSwitch
                  id="bringToFrontOnBackgroundDictationToggle"
                  testId="settings-bring-to-front-background-dictation"
                  label="Focus window on background dictation"
                  checked={bringToFrontOnBackgroundDictation}
                  onChange={(e) => setBringToFrontOnBackgroundDictation(e.target.checked)}
                />
                {isMac ? (
                  <>
                    <SettingsSwitch
                      id="globalFnHotkeyToggle"
                      testId="settings-global-fn-hotkey"
                      label="Menu bar shortcut"
                      checked={globalFnHotkey}
                      onChange={(e) => setGlobalFnHotkey(e.target.checked)}
                    />
                    {globalFnHotkey ? (
                      <FnShortcutControls
                        accessibilityTrusted={accessibilityTrusted}
                        setAccessibilityTrusted={setAccessibilityTrusted}
                        globalRecordingStatus={globalRecordingStatus}
                        refreshGlobalRecordingStatus={refreshGlobalRecordingStatus}
                      />
                    ) : null}
                  </>
                ) : null}
              </SettingsGroup>
              {isMac ? <ExternalButtonSettingsGroup /> : null}
            </VoiceSettingsTab>
          )}

          {activeTab === "accounts" && (
            <AccountsSettingsTab
              apiKey={apiKey}
              setApiKey={setApiKey}
              tavilyApiKey={tavilyApiKey}
              setTavilyApiKey={setTavilyApiKey}
              googleApiKey={googleApiKey}
              setGoogleApiKey={setGoogleApiKey}
              r2AccountId={r2AccountId}
              setR2AccountId={setR2AccountId}
              r2Bucket={r2Bucket}
              setR2Bucket={setR2Bucket}
              r2Prefix={r2Prefix}
              setR2Prefix={setR2Prefix}
              r2AccessKeyId={r2AccessKeyId}
              setR2AccessKeyId={setR2AccessKeyId}
              r2SecretAccessKey={r2SecretAccessKey}
              setR2SecretAccessKey={setR2SecretAccessKey}
              persistSettings={persistSettings}
              onShowSyncQr={() => setSyncQrOpen(true)}
              onSyncComplete={onSyncComplete}
              onRegisterRefresh={registerDataRefresh}
            />
          )}

          {activeTab === "data" && (
            <DataSettingsTab platform={platform} onImportComplete={onImportComplete} />
          )}

          <SyncQrModal
            open={syncQrOpen && secretsLoaded}
            onClose={() => setSyncQrOpen(false)}
            accountId={r2AccountId}
            bucket={r2Bucket}
            prefix={r2Prefix}
            accessKeyId={r2AccessKeyId}
            secretAccessKey={r2SecretAccessKey}
            openaiApiKey={apiKey}
          />
        </div>
        </SettingsSwitchProvider>
      </div>
      <SettingsSaveToast status={saveStatus} />
    </div>
  );
}
