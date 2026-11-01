import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { SETTINGS_PAGE_TITLE } from "../../shared/settingsPage";
import { SyncQrModal } from "./SyncQrModal";
import { CliInstallRow } from "./CliInstallRow";
import { ConnectionsSettingsTab } from "./ConnectionsSettingsTab";
import { DataSettingsTab } from "./DataSettingsTab";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { NotesTemplatesTab } from "./NotesTemplatesTab";
import { SettingsPane, SettingsSwitchRow } from "./SettingsPanel";
import { SettingsSaveToast } from "./SettingsSaveToast";
import { SettingsSwitchProvider } from "./SettingsSwitchContext";
import { StatusTab } from "./StatusTab";
import { SETTINGS_SYNC_SECTION_ID } from "./SyncPane";
import { VoiceSettingsTab } from "./VoiceSettingsTab";
import { WorkspaceHeader } from "../ui/WorkspaceHeader";
import { useSyncStatus } from "../hooks/useSyncStatus";
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
  const tabButtonRefs = useRef<Partial<Record<SettingsTabId, HTMLButtonElement | null>>>({});
  const [activeTab, setActiveTab] = useState<SettingsTabId>(normalizeSettingsTab(initialTab));
  const [syncQrOpen, setSyncQrOpen] = useState(false);
  const { visibleError: syncError, dismissError: dismissSyncError } = useSyncStatus();
  const [pendingSyncReview, setPendingSyncReview] = useState(false);

  const form = useSettingsForm({
    onSettingsChanged,
    wantsSecrets: shouldLoadSettingsSecrets(activeTab, syncQrOpen, false),
    pollRecordingStatus: activeTab === "voice" || activeTab === "status",
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
    accent, setAccent, appearanceTheme, setAppearanceTheme, cropCursor, setCropCursor,
    weatherZip, setWeatherZip,
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
    switchTab("data");
    setPendingSyncReview(true);
  };

  // Land on the Sync group and put the cursor in the first empty field.
  useEffect(() => {
    if (!pendingSyncReview || activeTab !== "data") return;
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
          {syncError && activeTab !== "data" && activeTab !== "status" ? (
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
          {activeTab === "status" && (
            <StatusTab
              engine={transcriptionEngine}
              globalFnHotkey={globalFnHotkey}
              isMac={isMac}
              onOpenTab={switchTab}
            />
          )}

          {activeTab === "general" && (
            <GeneralSettingsTab
              appearanceTheme={appearanceTheme}
              setAppearanceTheme={setAppearanceTheme}
              accent={accent}
              setAccent={setAccent}
              cropCursor={cropCursor}
              setCropCursor={setCropCursor}
              openToComposeOnLaunch={openToComposeOnLaunch}
              setOpenToComposeOnLaunch={setOpenToComposeOnLaunch}
              weatherZip={weatherZip}
              setWeatherZip={setWeatherZip}
              selectionImageLookup={selectionImageLookup}
              setSelectionImageLookup={setSelectionImageLookup}
            />
          )}

          {activeTab === "notes" && (
            <NotesTemplatesTab
              noteTemplates={noteTemplates}
              defaultNoteTemplateId={defaultNoteTemplateId}
              onTemplatesChange={handleTemplatesChange}
            >
              <SettingsPane title="Opening">
                <SettingsSwitchRow
                  id="openNoteInStickyWindowToggle"
                  testId="settings-open-note-in-window"
                  label="Open new notes in a window"
                  description="A small window that stays beside your work, instead of the editor."
                  checked={openNoteInStickyWindow}
                  onChange={(e) => onOpenNoteInStickyWindowChange?.(e.target.checked)}
                />
                {isMac ? <CliInstallRow /> : null}
              </SettingsPane>
            </NotesTemplatesTab>
          )}

          {activeTab === "voice" && (
            <VoiceSettingsTab
              isMac={isMac}
              globalFnHotkey={globalFnHotkey}
              setGlobalFnHotkey={setGlobalFnHotkey}
              accessibilityTrusted={accessibilityTrusted}
              setAccessibilityTrusted={setAccessibilityTrusted}
              globalRecordingStatus={globalRecordingStatus}
              refreshGlobalRecordingStatus={refreshGlobalRecordingStatus}
              transcriptionEngine={transcriptionEngine}
              setTranscriptionEngine={setTranscriptionEngine}
              cleanupEnabled={cleanupEnabled}
              setCleanupEnabled={setCleanupEnabled}
              cleanupPrompt={cleanupPrompt}
              setCleanupPrompt={setCleanupPrompt}
              transcriptGlossary={transcriptGlossary}
              setTranscriptGlossary={setTranscriptGlossary}
              autoSend={autoSend}
              setAutoSend={setAutoSend}
              bringToFrontOnBackgroundDictation={bringToFrontOnBackgroundDictation}
              setBringToFrontOnBackgroundDictation={setBringToFrontOnBackgroundDictation}
              openAIConfigured={openAIConfigured}
              secretsLoaded={secretsLoaded}
              apiKey={apiKey}
            />
          )}

          {activeTab === "connections" && (
            <ConnectionsSettingsTab
              apiKey={apiKey}
              setApiKey={setApiKey}
              tavilyApiKey={tavilyApiKey}
              setTavilyApiKey={setTavilyApiKey}
              googleApiKey={googleApiKey}
              setGoogleApiKey={setGoogleApiKey}
              persistSettings={persistSettings}
              secretsLoaded={secretsLoaded}
            />
          )}

          {activeTab === "data" && (
            <DataSettingsTab
              platform={platform}
              onImportComplete={onImportComplete}
              onSyncComplete={onSyncComplete}
              onRegisterRefresh={registerDataRefresh}
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
            />
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
