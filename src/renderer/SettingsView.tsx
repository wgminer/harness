import { useState, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { ExternalLink, Eye, EyeOff, Minus, Plus, Settings as SettingsIcon } from "lucide-react";
import { RIG_CONTEXT_TAB_LABEL, RIG_PAGE_TITLE } from "../shared/rigPage";
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS } from "../shared/types";
import type { LayoutOptions, Settings, TranscriptDictionaryEntry } from "../shared/types";
import type { UsageStatsSnapshot } from "../shared/usageStats";
import { EMPTY_USAGE_STATS } from "../shared/usageStats";
import { DATA_STORAGE_DIAGRAM } from "../shared/dataStorageLayout";
import {
  OPENAI_CHAT_MODEL,
  OPENAI_TITLE_MODEL,
  OPENAI_TRANSCRIPT_CLEANUP_MODEL,
} from "../shared/openaiModels";
import type { SyncConflict, SyncFolderSuggestion, SyncStatus } from "../shared/sync";
import type { SyncFileChoice } from "../shared/syncMerge";
import { SyncConflictReviewPanel } from "./SyncConflictReviewPanel";
import {
  DEFAULT_NOTE_TEMPLATES,
  NOTE_TEMPLATE_CURSOR_TOKEN,
  NOTE_TEMPLATE_TODAY_TOKEN,
  normalizeNoteTemplateDescription,
  normalizeNoteTemplates,
  type NoteTemplateConfig,
} from "../shared/writing";
import { useScrolledHeader } from "./useScrolledHeader";
import { Modal } from "./Modal";
import { WorkspaceHeader } from "./WorkspaceHeader";
import {
  SettingsActions,
  SettingsEntryRow,
  SettingsField,
  SettingsGroup,
  SettingsHint,
  SettingsSwitch,
  SettingsSwitchProvider,
} from "./settings";
import {
  applyThemeColors,
  coerceFontSizePx,
  DEFAULT_THEME_SETTINGS,
  enforceVeryLowContrastGuard,
  FONT_SIZE_OPTIONS,
  parseHexColor,
  MONO_FONTS,
  stepFontSize,
  normalizeColorPickerValue,
  themeMatchesColorPreset,
  themeSettingsToCss,
  THEME_PRESETS,
  UI_FONTS,
  type MonoFontId,
  type ThemeSettings,
  type UiFontId,
} from "../shared/theme";

interface SettingsViewProps {
  /** After ChatGPT import (new conversations in sidebar). */
  onImportComplete?: () => void;
}

const SAVE_DEBOUNCE_MS = 500;

const D = DEFAULT_SETTINGS;
type SettingsTabId = "general" | "tools" | "voice" | "notes" | "memory" | "data";

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: "general", label: "General" },
  { id: "tools", label: "Tools" },
  { id: "voice", label: "Voice" },
  { id: "notes", label: "Notes" },
  { id: "memory", label: RIG_CONTEXT_TAB_LABEL },
  { id: "data", label: "Data" },
];


export function SettingsView({ onImportComplete }: SettingsViewProps) {
  const [apiKey, setApiKey] = useState(D.openai!.apiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [usageStats, setUsageStats] = useState<UsageStatsSnapshot>(EMPTY_USAGE_STATS);
  const [switchAnimationsReady, setSwitchAnimationsReady] = useState(false);

  const [cleanupEnabled, setCleanupEnabled] = useState(D.transcription?.cleanup?.enabled ?? false);
  const [cleanupPrompt, setCleanupPrompt] = useState(D.transcription?.cleanup?.prompt ?? "");
  const [cleanupPromptDraft, setCleanupPromptDraft] = useState(D.transcription?.cleanup?.prompt ?? "");
  const [transcriptDictionary, setTranscriptDictionary] = useState<TranscriptDictionaryEntry[]>(
    D.transcription?.dictionary ?? [],
  );
  const [dictionaryModalOpen, setDictionaryModalOpen] = useState(false);
  const [editingDictionaryFrom, setEditingDictionaryFrom] = useState<string | null>(null);
  const [dictionaryFromDraft, setDictionaryFromDraft] = useState("");
  const [dictionaryToDraft, setDictionaryToDraft] = useState("");
  const [cleanupPromptModalOpen, setCleanupPromptModalOpen] = useState(false);
  const [noteTemplates, setNoteTemplates] = useState<NoteTemplateConfig[]>(
    DEFAULT_NOTE_TEMPLATES.map((t) => ({ ...t })),
  );
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateTitleDraft, setTemplateTitleDraft] = useState("");
  const [templateDescriptionDraft, setTemplateDescriptionDraft] = useState("");
  const [templateContentDraft, setTemplateContentDraft] = useState("");

  const [autoSend, setAutoSend] = useState(true);
  const [weatherZip, setWeatherZip] = useState(D.weather!.defaultZip);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [userMemory, setUserMemory] = useState<Record<string, string>>({});
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [editingMemoryKey, setEditingMemoryKey] = useState<string | null>(null);
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemDetail, setNewMemDetail] = useState("");
  const [importStatus, setImportStatus] = useState<{ imported: number; errors: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [claudeImportStatus, setClaudeImportStatus] = useState<{ imported: number; errors: string[] } | null>(null);
  const [claudeImporting, setClaudeImporting] = useState(false);
  const [compileStatus, setCompileStatus] = useState<{
    lastRunAt: number | null;
    lastRunDateLocal: string | null;
    lastAddedCount: number;
    lastUpdatedCount: number;
    lastConsideredCount: number;
    lastError: string | null;
  } | null>(null);
  const [compileBusy, setCompileBusy] = useState(false);
  const [compileMessage, setCompileMessage] = useState<string | null>(null);
  const [cleanupLegacyBusy, setCleanupLegacyBusy] = useState(false);
  const [cleanupLegacyMessage, setCleanupLegacyMessage] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncConflict, setSyncConflict] = useState<SyncConflict | null>(null);
  const [showSyncReview, setShowSyncReview] = useState(false);
  const [syncSuggestions, setSyncSuggestions] = useState<SyncFolderSuggestion[]>([]);
  const [dataStatus, setDataStatus] = useState<{
    localDataDir: string;
    appStateDir: string;
    localDataExists: boolean;
    conversationsCount: number;
    messageFilesCount: number;
    notesFilesCount: number;
    hasSettingsFile: boolean;
    hasThemesDir: boolean;
    recordingsDir: string;
    recordingsLocalOnly: true;
    legacyMemoryDir: string;
    legacyMemoryExists: boolean;
    sync: SyncStatus;
  } | null>(null);
  const [isMac] = useState(
    () => typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
  );
  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null);
  const [themeForm, setThemeForm] = useState<ThemeSettings>({ ...DEFAULT_THEME_SETTINGS });
  const [themeApplyError, setThemeApplyError] = useState<string | null>(null);
  const [layoutOptions, setLayoutOptions] = useState<LayoutOptions>(DEFAULT_LAYOUT);
  const themeApplySeqRef = useRef(0);
  const settingsHydratedRef = useRef(false);
  const skipAutosaveRef = useRef(false);
  const hideToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();
  const tabButtonRefs = useRef<Record<SettingsTabId, HTMLButtonElement | null>>({
    general: null,
    tools: null,
    voice: null,
    notes: null,
    memory: null,
    data: null,
  });
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  useEffect(() => {
    let cancelled = false;
    const enableSwitchAnimations = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setSwitchAnimationsReady(true);
        });
      });
    };
    void window.electron.settings
      .get()
      .then((s) => {
        if (cancelled) return;
        skipAutosaveRef.current = true;
        const S = s as Settings;
        setApiKey(S.openai?.apiKey ?? D.openai!.apiKey);
        setAutoSend(S.recording?.autoSend ?? D.recording!.autoSend);
        setCleanupEnabled(S.transcription?.cleanup?.enabled ?? D.transcription?.cleanup?.enabled ?? false);
        setCleanupPrompt(S.transcription?.cleanup?.prompt ?? D.transcription?.cleanup?.prompt ?? "");
        setCleanupPromptDraft(S.transcription?.cleanup?.prompt ?? D.transcription?.cleanup?.prompt ?? "");
        setTranscriptDictionary(S.transcription?.dictionary ?? D.transcription?.dictionary ?? []);
        setWeatherZip(S.weather?.defaultZip ?? D.weather!.defaultZip);
        setNoteTemplates(normalizeNoteTemplates(S.notes?.templates));
      })
      .finally(() => {
        if (!cancelled) settingsHydratedRef.current = true;
        enableSwitchAnimations();
      });
    void window.electron.usage.getStats().then(setUsageStats);
    window.electron.memory.getUserMemory().then(setUserMemory);
    window.electron.customization.getThemeSettings().then(setThemeForm);
    window.electron.customization.getLayoutOptions().then(setLayoutOptions);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isMac) return;
    void window.electron.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
  }, [isMac]);

  useEffect(() => {
    if (activeTab !== "data") return;
    void refreshDataStatus();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "memory") return;
    void refreshCompileStatus();
  }, [activeTab]);

  useEffect(() => {
    const unsub = window.electron.customization.onUpdated((payload) => {
      if (payload.type !== "layout") return;
      void window.electron.customization.getLayoutOptions().then(setLayoutOptions);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!settingsHydratedRef.current) return;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      await window.electron.settings.set({
        openai: { apiKey },
        recording: { autoSend },
        transcription: {
          cleanup: {
            enabled: cleanupEnabled,
            prompt: cleanupPrompt,
          },
          dictionary: transcriptDictionary,
        },
        weather: {
          defaultZip: weatherZip.trim(),
        },
      });
      setSaveStatus("saved");
      if (hideToastRef.current) clearTimeout(hideToastRef.current);
      hideToastRef.current = setTimeout(() => {
        setSaveStatus("idle");
        hideToastRef.current = null;
      }, 1500);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      if (hideToastRef.current) {
        clearTimeout(hideToastRef.current);
        hideToastRef.current = null;
      }
    };
  }, [apiKey, autoSend, cleanupEnabled, cleanupPrompt, transcriptDictionary, weatherZip]);

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

  const closeTemplatesModal = () => {
    setTemplatesModalOpen(false);
    setEditingTemplateId(null);
    setTemplateTitleDraft("");
    setTemplateDescriptionDraft("");
    setTemplateContentDraft("");
  };

  const openTemplateModal = (template: NoteTemplateConfig) => {
    setEditingTemplateId(template.id);
    setTemplateTitleDraft(template.title);
    setTemplateDescriptionDraft(template.description);
    setTemplateContentDraft(template.content);
    setTemplatesModalOpen(true);
  };

  const saveTemplate = async () => {
    if (!editingTemplateId) return;
    const nextTitle = templateTitleDraft.trim();
    const nextDescription = normalizeNoteTemplateDescription(templateDescriptionDraft);
    if (!nextTitle || !nextDescription) return;
    const nextTemplates = noteTemplates.map((template) =>
      template.id === editingTemplateId
        ? {
            ...template,
            title: nextTitle,
            description: nextDescription,
            content: templateContentDraft,
          }
        : template,
    );
    const normalized = normalizeNoteTemplates(nextTemplates);
    setNoteTemplates(normalized);
    await window.electron.settings.set({ notes: { templates: normalized } });
    window.dispatchEvent(new CustomEvent("notes:templatesUpdated", { detail: normalized }));
    closeTemplatesModal();
  };

  const closeMemoryModal = () => {
    setMemoryModalOpen(false);
    setEditingMemoryKey(null);
    setNewMemTitle("");
    setNewMemDetail("");
  };

  const openAddMemoryModal = () => {
    setEditingMemoryKey(null);
    setNewMemTitle("");
    setNewMemDetail("");
    setMemoryModalOpen(true);
  };

  const openEditMemoryModal = (key: string, detail: string) => {
    setEditingMemoryKey(key);
    setNewMemTitle(key);
    setNewMemDetail(detail);
    setMemoryModalOpen(true);
  };

  const saveMemory = async () => {
    if (!newMemTitle.trim()) return;
    const nextTitle = newMemTitle.trim();
    const nextDetail = newMemDetail.trim();
    if (editingMemoryKey && editingMemoryKey !== nextTitle) {
      await window.electron.memory.deleteUserMemoryKey(editingMemoryKey);
    }
    await window.electron.memory.setUserMemory(nextTitle, nextDetail);
    setUserMemory(await window.electron.memory.getUserMemory());
    closeMemoryModal();
  };

  const deleteMemoryEntry = async (key: string) => {
    await window.electron.memory.deleteUserMemoryKey(key);
    setUserMemory(await window.electron.memory.getUserMemory());
  };

  const refreshDataStatus = async () => {
    const status = await window.electron.memory.getDataStatus();
    setDataStatus(status);
  };

  const runCleanupLegacyMemory = async () => {
    setCleanupLegacyBusy(true);
    setCleanupLegacyMessage(null);
    try {
      const result = await window.electron.memory.cleanupLegacyMemory();
      setCleanupLegacyMessage(result.removed ? "Removed legacy memory folder." : "No legacy memory folder to remove.");
      await refreshDataStatus();
    } finally {
      setCleanupLegacyBusy(false);
    }
  };

  const runSyncNow = async () => {
    setSyncBusy(true);
    setSyncMessage(null);
    setSyncConflict(null);
    setShowSyncReview(false);
    try {
      const result = await window.electron.sync.runNow();
      if (result.conflict) {
        setSyncConflict(result.conflict);
        setShowSyncReview(false);
        setSyncMessage("Local and backup both changed. Review changes or pick a side.");
      } else if (result.ok) {
        const action = result.status.lastAction;
        const summary =
          action === "push"
            ? "Pushed local changes to backup."
            : action === "pull"
              ? "Pulled newer backup into local data."
              : "Already in sync.";
        setSyncMessage(summary);
      } else {
        setSyncMessage(result.status.lastError ?? "Sync failed.");
      }
      await refreshDataStatus();
    } finally {
      setSyncBusy(false);
    }
  };

  const resolveSyncConflict = async (resolution: "push" | "pull") => {
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const result = await window.electron.sync.resolveConflict(resolution);
      setSyncConflict(null);
      setShowSyncReview(false);
      if (result.ok) {
        const summary =
          resolution === "push"
            ? "Kept this device’s changes and updated the backup."
            : "Used the backup. Your previous local data was saved under local-data/sync/backups/.";
        setSyncMessage(summary);
      } else {
        setSyncMessage(result.status.lastError ?? "Sync failed.");
      }
      await refreshDataStatus();
    } finally {
      setSyncBusy(false);
    }
  };

  const applySyncMerge = async (choices: Record<string, SyncFileChoice>) => {
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const result = await window.electron.sync.resolveConflict({ mode: "merge", choices });
      setSyncConflict(null);
      setShowSyncReview(false);
      if (result.ok) {
        setSyncMessage("Merged changes applied and pushed to the backup folder.");
      } else {
        setSyncMessage(result.status.lastError ?? "Merge failed.");
      }
      await refreshDataStatus();
    } finally {
      setSyncBusy(false);
    }
  };

  const pickBackupFolder = async () => {
    const chosen = await window.electron.sync.pickFolder();
    if (chosen) {
      setSyncMessage(null);
      await refreshDataStatus();
    }
  };

  const useSuggestedFolder = async (path: string) => {
    await window.electron.sync.setFolder(path);
    setSyncMessage(null);
    await refreshDataStatus();
  };

  const defaultBackupPath = useMemo(
    () => syncSuggestions.find((s) => s.label === "iCloud Drive")?.path ?? null,
    [syncSuggestions],
  );

  const useDefaultBackupFolder = async () => {
    if (!defaultBackupPath) return;
    await useSuggestedFolder(defaultBackupPath);
  };

  useEffect(() => {
    if (activeTab !== "data") return;
    void window.electron.sync.listSuggestions().then(setSyncSuggestions);
  }, [activeTab]);

  const runImport = async () => {
    setImporting(true);
    setImportStatus(null);
    try {
      const result = await window.electron.memory.importFromChatGPTFolder();
      setImportStatus(result);
      if (result.imported > 0) onImportComplete?.();
    } catch (e) {
      setImportStatus({
        imported: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setImporting(false);
    }
  };

  const runClaudeImport = async () => {
    setClaudeImporting(true);
    setClaudeImportStatus(null);
    try {
      const result = await window.electron.memory.importFromClaudeFolder();
      setClaudeImportStatus(result);
      if (result.imported > 0) onImportComplete?.();
    } catch (e) {
      setClaudeImportStatus({
        imported: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setClaudeImporting(false);
    }
  };

  const refreshCompileStatus = async () => {
    const status = await window.electron.memory.getCompileStatus();
    setCompileStatus(status);
  };

  const runCompileNow = async () => {
    setCompileBusy(true);
    setCompileMessage(null);
    try {
      const response = await window.electron.memory.runCompileNow();
      if (response.ok) {
        const r = response.result;
        if (r.skipped) {
          setCompileMessage("No new conversations to compile yet.");
        } else if (r.added === 0 && r.updated === 0) {
          setCompileMessage(`Reviewed ${r.considered} conversation${r.considered === 1 ? "" : "s"}; nothing durable to add.`);
        } else {
          setCompileMessage(
            `Reviewed ${r.considered} conversation${r.considered === 1 ? "" : "s"}: added ${r.added}, updated ${r.updated}.`
          );
        }
      } else {
        setCompileMessage(response.error);
      }
      await refreshCompileStatus();
      setUserMemory(await window.electron.memory.getUserMemory());
    } finally {
      setCompileBusy(false);
    }
  };

  const applyThemeCssImmediately = (settings: ThemeSettings | null) => {
    const el = document.getElementById("custom-theme") as HTMLStyleElement | null;
    if (!el) return;
    if (settings === null) {
      el.textContent = "";
      return;
    }
    el.textContent = themeSettingsToCss(settings);
  };

  const areThemeColorsCompleteHex = (settings: ThemeSettings): boolean =>
    parseHexColor(settings.bg) != null &&
    parseHexColor(settings.fg) != null &&
    parseHexColor(settings.accent) != null;

  const updateThemeForm = (
    updater: (prev: ThemeSettings) => ThemeSettings,
    options?: { skipContrastGuard?: boolean },
  ) => {
    setThemeForm((prev) => {
      const updated = updater(prev);
      if (!areThemeColorsCompleteHex(updated)) {
        setThemeApplyError(null);
        return updated;
      }
      const changedFg = updated.fg !== prev.fg;
      const changedBg = updated.bg !== prev.bg;
      const next =
        !options?.skipContrastGuard && changedFg !== changedBg
          ? {
              ...updated,
              ...enforceVeryLowContrastGuard(
                { fg: updated.fg, bg: updated.bg },
                changedFg ? "fg" : "bg",
              ),
            }
          : updated;
      applyThemeCssImmediately(next);
      const seq = ++themeApplySeqRef.current;
      setThemeApplyError(null);
      void window.electron.customization
        .setThemeSettings(next)
        .catch((e) => {
          if (seq !== themeApplySeqRef.current) return;
          setThemeApplyError(e instanceof Error ? e.message : String(e));
        });
      return next;
    });
  };

  const updateLayoutOptions = (patch: Partial<LayoutOptions>) => {
    setLayoutOptions((prev) => ({ ...prev, ...patch }));
    void window.electron.customization.setLayout(patch);
  };

  const switchTab = (id: SettingsTabId) => {
    setActiveTab(id);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "auto" });
    }
  };

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
      <WorkspaceHeader
        title={RIG_PAGE_TITLE}
        icon={<SettingsIcon size={18} />}
        scrolled={headerScrolled}
        actions={
          <div
            className={`settings-tabs settings-tabs--header${headerScrolled ? " settings-tabs--latched" : ""}`}
            role="tablist"
            aria-label={`${RIG_PAGE_TITLE} sections`}
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
        }
      />
      <div
        className={`settings-toast${saveStatus !== "idle" ? " settings-toast--visible" : ""}`}
        role="status"
        aria-live="polite"
        aria-hidden={saveStatus === "idle"}
      >
        {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : ""}
      </div>
      <div ref={scrollRef} className="workspace-scroll settings-scroll" onScroll={onScroll}>
        <SettingsSwitchProvider animationsReady={switchAnimationsReady}>
        <div className="workspace-content settings-content">
          {activeTab === "general" && <section
            id="settings-panel-general"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-general"
          >
            <SettingsGroup
              title="Chat model"
              description="Paste your key from OpenAI. Chat replies, conversation titles, and transcript cleanup all use it; voice transcription runs on your Mac."
            >
              <SettingsField label="API key" htmlFor="settings-api-key">
                <div className="settings-api-key-row">
                  <input
                    id="settings-api-key"
                    type={showApiKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-…"
                    autoComplete="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                  />
                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-pressed={showApiKey}
                    aria-label={showApiKey ? "Hide API key" : "Show API key"}
                    title={showApiKey ? "Hide key" : "Show key"}
                    onClick={() => setShowApiKey((v) => !v)}
                  >
                    {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </SettingsField>
              <dl className="usage-stats settings-model-list" aria-label="Models in use">
                <div className="usage-stats__row">
                  <dt>Chat replies</dt>
                  <dd><code>{OPENAI_CHAT_MODEL}</code></dd>
                </div>
                <div className="usage-stats__row">
                  <dt>Conversation titles</dt>
                  <dd><code>{OPENAI_TITLE_MODEL}</code></dd>
                </div>
                <div className="usage-stats__row">
                  <dt>Transcript cleanup</dt>
                  <dd><code>{OPENAI_TRANSCRIPT_CLEANUP_MODEL}</code></dd>
                </div>
              </dl>
              <SettingsHint flush>
                Models are pinned in this build — there&apos;s no in-app picker.
              </SettingsHint>
            </SettingsGroup>

            <SettingsGroup
              title="Theme studio"
              descriptionClassName="settings-group__lead--tight"
              description={
                <>
                  Pick a color palette or tune background, text, and accent. Typography is separate below. Changes apply
                  instantly and save to your theme (replacing any previous custom theme from this screen or tools).
                </>
              }
            >
              <div className="settings-playground">
                <div className="settings-playground-tools settings-section">
                  <div className="settings-playground-block">
                    <h4 className="settings-playground-block__title">Color themes</h4>
                    <div className="settings-playground-presets" role="list" aria-label="Color theme presets">
                    {THEME_PRESETS.map((preset) => {
                      const selected = themeMatchesColorPreset(themeForm, preset.colors);
                      const previewBg = normalizeColorPickerValue(preset.colors.bg);
                      const previewFg = normalizeColorPickerValue(preset.colors.fg);
                      const previewAccent = normalizeColorPickerValue(preset.colors.accent);
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="listitem"
                          className={`settings-playground-theme-card${selected ? " settings-playground-theme-card--selected" : ""}`}
                          onClick={() => updateThemeForm((f) => applyThemeColors(f, preset.colors))}
                          aria-pressed={selected}
                          aria-label={`Apply ${preset.label} colors`}
                        >
                          <div
                            className="settings-playground-theme-preview"
                            style={{ background: previewBg, color: previewFg }}
                          >
                            <span className="settings-playground-theme-preview__line" aria-hidden />
                            <span
                              className="settings-playground-theme-preview__line settings-playground-theme-preview__line--short"
                              aria-hidden
                            />
                            <span
                              className="settings-playground-theme-preview__accent"
                              style={{ background: previewAccent }}
                              aria-hidden
                            />
                          </div>
                          <span className="settings-playground-theme-card__label">{preset.label}</span>
                        </button>
                      );
                    })}
                    </div>
                  </div>
                  <div className="settings-playground-block" aria-label="Custom colors">
                    <h4 className="settings-playground-block__title">Custom colors</h4>
                      <div className="settings-playground-field">
                        <label htmlFor="theme-bg">Background color</label>
                        <div className="settings-playground-color-row">
                          <input
                            id="theme-bg"
                            type="color"
                            value={normalizeColorPickerValue(themeForm.bg)}
                            onChange={(e) => updateThemeForm((f) => ({ ...f, bg: e.target.value }))}
                            aria-label="Background color picker"
                          />
                          <input
                            type="text"
                            value={themeForm.bg}
                            onChange={(e) =>
                              updateThemeForm((f) => ({ ...f, bg: e.target.value }), {
                                skipContrastGuard: true,
                              })
                            }
                            spellCheck={false}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            aria-label="Background hex"
                          />
                        </div>
                      </div>
                      <div className="settings-playground-field">
                        <label htmlFor="theme-fg">Text color</label>
                        <div className="settings-playground-color-row">
                          <input
                            id="theme-fg"
                            type="color"
                            value={normalizeColorPickerValue(themeForm.fg)}
                            onChange={(e) => updateThemeForm((f) => ({ ...f, fg: e.target.value }))}
                            aria-label="Text color picker"
                          />
                          <input
                            type="text"
                            value={themeForm.fg}
                            onChange={(e) =>
                              updateThemeForm((f) => ({ ...f, fg: e.target.value }), {
                                skipContrastGuard: true,
                              })
                            }
                            spellCheck={false}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            aria-label="Text color hex"
                          />
                        </div>
                      </div>
                      <div className="settings-playground-field">
                        <label htmlFor="theme-accent">Accent color</label>
                        <div className="settings-playground-color-row">
                          <input
                            id="theme-accent"
                            type="color"
                            value={normalizeColorPickerValue(themeForm.accent)}
                            onChange={(e) => updateThemeForm((f) => ({ ...f, accent: e.target.value }))}
                            aria-label="Accent color picker"
                          />
                          <input
                            type="text"
                            value={themeForm.accent}
                            onChange={(e) =>
                              updateThemeForm((f) => ({ ...f, accent: e.target.value }), {
                                skipContrastGuard: true,
                              })
                            }
                            spellCheck={false}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            aria-label="Accent hex"
                          />
                        </div>
                      </div>
                  </div>
                  <div className="settings-playground-block" aria-label="Typography">
                    <h4 className="settings-playground-block__title">Typography</h4>
                    <p className="settings-playground-block__lead">
                      UI and code fonts load with the app (Google Fonts). Independent of color themes above.
                    </p>
                      <div className="settings-playground-field">
                        <label htmlFor="theme-font">UI font</label>
                        <select
                          id="theme-font"
                          value={themeForm.font}
                          onChange={(e) =>
                            updateThemeForm((f) => ({ ...f, font: e.target.value as UiFontId }))
                          }
                        >
                          {UI_FONTS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="settings-playground-field">
                        <label htmlFor="theme-font-mono">Code / notes font</label>
                        <select
                          id="theme-font-mono"
                          value={themeForm.fontMono}
                          onChange={(e) =>
                            updateThemeForm((f) => ({ ...f, fontMono: e.target.value as MonoFontId }))
                          }
                        >
                          {MONO_FONTS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="settings-playground-field">
                        <label id="theme-font-size-label" htmlFor="theme-font-size">
                          Base font size
                        </label>
                        <div
                          className="settings-font-size-stepper"
                          role="group"
                          aria-labelledby="theme-font-size-label"
                        >
                          <div
                            className="settings-font-size-stepper__control"
                            role="button"
                            tabIndex={themeForm.fontSize === FONT_SIZE_OPTIONS[0] ? -1 : 0}
                            aria-disabled={
                              themeForm.fontSize === FONT_SIZE_OPTIONS[0] || undefined
                            }
                            aria-label="Decrease base font size"
                            onClick={() => {
                              if (themeForm.fontSize === FONT_SIZE_OPTIONS[0]) return;
                              updateThemeForm((f) => ({
                                ...f,
                                fontSize: stepFontSize(f.fontSize, -1),
                              }));
                            }}
                            onKeyDown={(e) => {
                              if (themeForm.fontSize === FONT_SIZE_OPTIONS[0]) return;
                              if (e.key !== "Enter" && e.key !== " ") return;
                              e.preventDefault();
                              updateThemeForm((f) => ({
                                ...f,
                                fontSize: stepFontSize(f.fontSize, -1),
                              }));
                            }}
                          >
                            <Minus size={16} aria-hidden />
                          </div>
                          <div className="settings-font-size-stepper__input-wrap">
                            <input
                              id="theme-font-size"
                              className="settings-font-size-stepper__input"
                              type="number"
                              inputMode="numeric"
                              min={FONT_SIZE_OPTIONS[0]}
                              max={FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1]}
                              value={themeForm.fontSize}
                              onChange={(e) => {
                                const n = Math.round(Number(e.target.value));
                                if (!Number.isFinite(n)) return;
                                if (!FONT_SIZE_OPTIONS.includes(n as (typeof FONT_SIZE_OPTIONS)[number])) {
                                  return;
                                }
                                updateThemeForm((f) => ({
                                  ...f,
                                  fontSize: n as (typeof FONT_SIZE_OPTIONS)[number],
                                }));
                              }}
                              onBlur={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                updateThemeForm((f) => ({
                                  ...f,
                                  fontSize: coerceFontSizePx(n),
                                }));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  updateThemeForm((f) => ({
                                    ...f,
                                    fontSize: stepFontSize(f.fontSize, 1),
                                  }));
                                } else if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  updateThemeForm((f) => ({
                                    ...f,
                                    fontSize: stepFontSize(f.fontSize, -1),
                                  }));
                                }
                              }}
                              aria-label="Base font size in pixels"
                            />
                            <span className="settings-font-size-stepper__unit" aria-hidden="true">
                              px
                            </span>
                          </div>
                          <div
                            className="settings-font-size-stepper__control"
                            role="button"
                            tabIndex={
                              themeForm.fontSize ===
                              FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1]
                                ? -1
                                : 0
                            }
                            aria-disabled={
                              themeForm.fontSize ===
                                FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1] || undefined
                            }
                            aria-label="Increase base font size"
                            onClick={() => {
                              if (
                                themeForm.fontSize ===
                                FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1]
                              ) {
                                return;
                              }
                              updateThemeForm((f) => ({
                                ...f,
                                fontSize: stepFontSize(f.fontSize, 1),
                              }));
                            }}
                            onKeyDown={(e) => {
                              if (
                                themeForm.fontSize ===
                                FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1]
                              ) {
                                return;
                              }
                              if (e.key !== "Enter" && e.key !== " ") return;
                              e.preventDefault();
                              updateThemeForm((f) => ({
                                ...f,
                                fontSize: stepFontSize(f.fontSize, 1),
                              }));
                            }}
                          >
                            <Plus size={16} aria-hidden />
                          </div>
                        </div>
                      </div>
                  </div>
                  {themeApplyError && (
                    <p className="settings-playground-status settings-playground-status--err" role="alert">
                      {themeApplyError}
                    </p>
                  )}
                </div>
              </div>
            </SettingsGroup>

            <SettingsGroup
              title="Layout aids"
              description="Optional visual grid overlay for alignment checks while designing screens."
            >
              <SettingsField label="Grid overlay" htmlFor="settings-grid-overlay">
                <select
                  id="settings-grid-overlay"
                  value={layoutOptions.gridOverlay}
                  onChange={(e) =>
                    updateLayoutOptions({
                      gridOverlay: e.target.value as LayoutOptions["gridOverlay"],
                    })
                  }
                >
                  <option value="off">Off</option>
                  <option value="4">4px grid</option>
                  <option value="8">8px grid</option>
                  <option value="16">16px grid</option>
                </select>
              </SettingsField>
              <SettingsHint flush>
                Overlay is visual only and does not capture clicks.
              </SettingsHint>
            </SettingsGroup>
          </section>}

          {activeTab === "tools" && <section
            id="settings-panel-tools"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-tools"
          >
            <SettingsGroup
              title="Weather tool"
              description={
                <>
                  Default US ZIP used by the <code>get_weather</code> tool when the assistant does not specify a location.
                  Powered by Open-Meteo (no API key).
                </>
              }
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
          </section>}

          {activeTab === "voice" && <section
            id="settings-panel-voice"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-voice"
          >
            <SettingsGroup
              title="Voice & transcription"
              description="Spoken audio is turned into text on this device. Optional cleanup uses your API key."
            >
              <SettingsSwitch
                id="transcriptCleanupToggle"
                label="Automatically tidy up dictation text"
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
                    Edit prompt
                  </button>
                </SettingsActions>
              ) : null}
            </SettingsGroup>

            <SettingsGroup
              title="Transcript corrections"
              description="Deterministic fixes applied after transcription (kept separate from cleanup prompt)."
            >
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
              <SettingsActions>
                <button type="button" className="btn" onClick={openAddDictionaryModal}>
                  Add correction
                </button>
              </SettingsActions>
            </SettingsGroup>

            <SettingsGroup
              title="Usage & recordings"
              description="Local transcription usage on this device."
            >
              <dl className="usage-stats">
                <div className="usage-stats__row">
                  <dt>Parakeet words transcribed</dt>
                  <dd>{usageStats.parakeet.words.toLocaleString()}</dd>
                </div>
                <div className="usage-stats__row">
                  <dt>Dictation sessions</dt>
                  <dd>{usageStats.parakeet.transcriptions.toLocaleString()}</dd>
                </div>
              </dl>
              <SettingsActions>
                <button
                  type="button"
                  className="btn"
                  onClick={() => window.electron.recording.openFolder()}
                >
                  Show Recordings <ExternalLink size={14} aria-hidden />
                </button>
              </SettingsActions>
            </SettingsGroup>

            {isMac && (
              <SettingsGroup
                title="Fn shortcut"
                description={
                  <>
                    Press <strong>Fn</strong> to start recording, press again to stop. Harness needs Accessibility;
                    allow <code>HarnessFnMonitor</code> too if macOS lists it.
                  </>
                }
              >
                <SettingsHint flush>
                  After changing permissions, quit and reopen the app. Use the buttons if macOS doesn’t prompt you.
                </SettingsHint>
                <SettingsActions>
                  {accessibilityTrusted !== true && (
                    <button
                      type="button"
                      className="btn"
                      data-testid="settings-accessibility-prompt"
                      onClick={() => {
                        void window.electron.system.requestAccessibilityPrompt();
                        setTimeout(() => {
                          void window.electron.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
                        }, 800);
                      }}
                    >
                      Ask for permission <ExternalLink size={14} aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn"
                    data-testid="settings-open-accessibility"
                    onClick={() => {
                      void window.electron.system.openAccessibilitySettings();
                      setTimeout(() => {
                        void window.electron.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
                      }, 1500);
                    }}
                  >
                    Open accessibility <ExternalLink size={14} aria-hidden />
                  </button>
                </SettingsActions>
                <SettingsHint flush>
                  {accessibilityTrusted === true
                    ? "Accessibility looks good. If Fn still won’t work, restart and check both Harness and Fn Monitor."
                    : accessibilityTrusted === false
                      ? "Accessibility not enabled yet."
                      : "Checking…"}
                </SettingsHint>
              </SettingsGroup>
            )}

            <SettingsGroup
              title="After dictation"
              description="Send the transcribed message right away in a new chat."
            >
              <SettingsSwitch
                id="autoSendToggle"
                testId="settings-auto-send"
                label="Auto-send"
                checked={autoSend}
                onChange={(e) => setAutoSend(e.target.checked)}
              />
            </SettingsGroup>
          </section>}

          {activeTab === "notes" && <section
            id="settings-panel-notes"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-notes"
          >
            <SettingsGroup
              title="Notes templates"
              description="Edit the three note templates shown on the Notes overview page."
            >
              <div className="settings-entry-list">
                {noteTemplates.map((template) => (
                  <SettingsEntryRow
                    key={template.id}
                    title={template.title}
                    detail={template.description}
                    onEdit={() => openTemplateModal(template)}
                    editAriaLabel={`Edit ${template.title} template`}
                    editButtonTitle="Edit template"
                  />
                ))}
              </div>
            </SettingsGroup>
          </section>}

          {activeTab === "memory" && <section
            id="settings-panel-memory"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-memory"
          >
            <SettingsGroup
              title="User facts"
              description="Stable facts merged into the model context when relevant. Pick a short label and a one-line value; the same label updates the existing entry."
            >
              <div className="settings-entry-list">
                {Object.entries(userMemory).map(([k, v]) => (
                  <SettingsEntryRow
                    key={k}
                    title={k}
                    detail={v}
                    onEdit={() => openEditMemoryModal(k, v)}
                    onDelete={() => void deleteMemoryEntry(k)}
                    editAriaLabel={`Edit ${k}`}
                    deleteAriaLabel={`Remove ${k}`}
                  />
                ))}
              </div>
              <SettingsActions>
                <button
                  type="button"
                  className="btn"
                  data-testid="settings-add-memory"
                  onClick={openAddMemoryModal}
                >
                  Add entry
                </button>
              </SettingsActions>
            </SettingsGroup>

            <SettingsGroup
              title="Compile from conversations"
              description={
                <>
                  Reviews conversations updated since the last run and adds durable facts to the list
                  above. Uses your OpenAI API key. Auto-merges without asking — edit or remove entries
                  any time. Manual-only for now; runs only when you press the button below.
                </>
              }
            >
              <SettingsActions>
                <button
                  type="button"
                  className="btn"
                  data-testid="settings-run-memory-compile"
                  onClick={() => void runCompileNow()}
                  disabled={compileBusy}
                >
                  {compileBusy ? "Compiling…" : "Compile now"}
                </button>
              </SettingsActions>
              {compileStatus && (
                <div className="settings-data-status" role="status">
                  <p>
                    <strong>Last run:</strong>{" "}
                    {compileStatus.lastRunAt
                      ? new Date(compileStatus.lastRunAt).toLocaleString()
                      : "never"}
                  </p>
                  {compileStatus.lastRunAt != null && (
                    <p>
                      <strong>Last result:</strong> reviewed{" "}
                      {compileStatus.lastConsideredCount} conversation
                      {compileStatus.lastConsideredCount === 1 ? "" : "s"}, added{" "}
                      {compileStatus.lastAddedCount}, updated{" "}
                      {compileStatus.lastUpdatedCount}
                    </p>
                  )}
                  {compileStatus.lastError && (
                    <p className="settings-import-status__errors">
                      Last error: {compileStatus.lastError}
                    </p>
                  )}
                </div>
              )}
              {compileMessage && (
                <SettingsHint flush>{compileMessage}</SettingsHint>
              )}
            </SettingsGroup>
          </section>}

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
                <button type="button" className="btn" onClick={resetCleanupPromptDraft}>
                  Reset to default
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
            <div className="settings-entry-modal-stack">
              <label className="settings-entry-field">
                <span className="settings-entry-field__label">Prompt text</span>
                <textarea
                  placeholder="Describe how dictation should be cleaned up."
                  value={cleanupPromptDraft}
                  onChange={(e) => setCleanupPromptDraft(e.target.value)}
                  className="app-modal-input settings-entry-detail-input"
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
            <div className="settings-entry-modal-stack">
              <label className="settings-entry-field">
                <span className="settings-entry-field__label">Heard as</span>
                <input
                  type="text"
                  placeholder="e.g. wig em"
                  value={dictionaryFromDraft}
                  onChange={(e) => setDictionaryFromDraft(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
              <label className="settings-entry-field">
                <span className="settings-entry-field__label">Replace with</span>
                <input
                  type="text"
                  placeholder="e.g. WGM"
                  value={dictionaryToDraft}
                  onChange={(e) => setDictionaryToDraft(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
            </div>
          </Modal>

          <Modal
            open={memoryModalOpen}
            onClose={closeMemoryModal}
            title={editingMemoryKey ? "Edit entry" : "Add entry"}
            data-testid="settings-memory-modal"
            footer={
              <>
                <button type="button" className="btn" onClick={closeMemoryModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveMemory()}
                  disabled={!newMemTitle.trim()}
                >
                  {editingMemoryKey ? "Update" : "Save"}
                </button>
              </>
            }
          >
            <div className="settings-entry-modal-stack">
              <label className="settings-entry-field">
                <span className="settings-entry-field__label">Label</span>
                <input
                  type="text"
                  placeholder="e.g. timezone"
                  value={newMemTitle}
                  onChange={(e) => setNewMemTitle(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
              <label className="settings-entry-field">
                <span className="settings-entry-field__label">Detail</span>
                <textarea
                  placeholder="What to remember"
                  value={newMemDetail}
                  onChange={(e) => setNewMemDetail(e.target.value)}
                  className="app-modal-input settings-entry-detail-input"
                  rows={4}
                  autoComplete="off"
                />
              </label>
            </div>
          </Modal>

          <Modal
            open={templatesModalOpen}
            onClose={closeTemplatesModal}
            title="Edit notes template"
            data-testid="settings-notes-template-modal"
            footer={
              <>
                <button type="button" className="btn" onClick={closeTemplatesModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveTemplate()}
                  disabled={!templateTitleDraft.trim() || !templateDescriptionDraft.trim()}
                >
                  Save
                </button>
              </>
            }
          >
            <div className="settings-entry-modal-stack">
              <label className="settings-entry-field">
                <span className="settings-entry-field__label">Title</span>
                <input
                  type="text"
                  value={templateTitleDraft}
                  onChange={(e) => setTemplateTitleDraft(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
              <label className="settings-entry-field">
                <span className="settings-entry-field__label">Description</span>
                <input
                  type="text"
                  value={templateDescriptionDraft}
                  onChange={(e) => setTemplateDescriptionDraft(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
              <label className="settings-entry-field">
                <span className="settings-entry-field__label">Template body</span>
                <p className="settings-group__hint settings-entry-hint">
                  Use <code>{NOTE_TEMPLATE_TODAY_TOKEN}</code> for today&apos;s date and{" "}
                  <code>{NOTE_TEMPLATE_CURSOR_TOKEN}</code> to place the cursor when the note opens.
                </p>
                <textarea
                  value={templateContentDraft}
                  onChange={(e) => setTemplateContentDraft(e.target.value)}
                  className="app-modal-input settings-entry-detail-input settings-entry-template-content-input"
                  rows={10}
                />
              </label>
            </div>
          </Modal>

          {activeTab === "data" && <section
            id="settings-panel-data"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-data"
          >
            <SettingsGroup
              title="Storage layout"
              description={
                <>
                  Everything Harness saves on this device. Sync copies a snapshot of{" "}
                  <code>local-data</code> (except recordings) into your chosen backup folder;
                  your cloud provider moves that folder between machines.
                </>
              }
            >
              <figure className="settings-storage-diagram" aria-label="Storage layout diagram">
                <pre className="settings-storage-diagram__pre">{DATA_STORAGE_DIAGRAM}</pre>
              </figure>
              <SettingsActions>
                <button type="button" className="btn" onClick={() => window.electron.memory.openAppDataFolder()}>
                  Show app data folder <ExternalLink size={14} aria-hidden />
                </button>
                <button type="button" className="btn" onClick={() => void runCleanupLegacyMemory()} disabled={cleanupLegacyBusy}>
                  {cleanupLegacyBusy ? "Cleaning…" : "Clean legacy memory folder"}
                </button>
              </SettingsActions>
              {cleanupLegacyMessage && (
                <SettingsHint flush>{cleanupLegacyMessage}</SettingsHint>
              )}
            </SettingsGroup>

            <SettingsGroup
              title="Backup folder"
              description={
                <>
                  Pick a folder Harness can read and write — anything inside iCloud Drive, Dropbox,
                  Google Drive, OneDrive, a network share, or an external drive works. Sync now writes
                  a single bundle + manifest there; your sync provider moves those files between
                  devices. Each device should point at the <strong>same</strong> folder.
                </>
              }
            >
              {!dataStatus?.sync.backupFolderPath ? (
                <>
                  <SettingsActions>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void pickBackupFolder()}
                    >
                      Choose folder…
                    </button>
                    {defaultBackupPath && (
                      <button type="button" className="btn" onClick={() => void useDefaultBackupFolder()}>
                        Use iCloud Drive default
                      </button>
                    )}
                  </SettingsActions>
                  <SettingsHint flush>
                    You&apos;ll be able to sync once you pick a folder.
                  </SettingsHint>
                </>
              ) : dataStatus.sync.configured ? (
                <>
                  <div className="settings-data-status" role="status">
                    <p className="settings-data-status__path-row">
                      <strong>Backup folder:</strong>{" "}
                      <code>{dataStatus.sync.backupFolderPath}</code>
                      <button
                        type="button"
                        className="btn settings-data-status__change-btn"
                        onClick={() => void pickBackupFolder()}
                      >
                        Change…
                      </button>
                    </p>
                    {dataStatus.sync.lastSuccessAt && (
                      <p>
                        <strong>Last sync:</strong>{" "}
                        {new Date(dataStatus.sync.lastSuccessAt).toLocaleString()}
                        {dataStatus.sync.lastAction && (
                          <> ({dataStatus.sync.lastAction})</>
                        )}
                      </p>
                    )}
                    {dataStatus.sync.lastError && (
                      <p className="settings-import-status__errors">
                        Last error: {dataStatus.sync.lastError}
                      </p>
                    )}
                    {dataStatus.sync.conflictCopies.length > 0 && (
                      <p className="settings-import-status__errors">
                        Conflict copies in backup folder: {dataStatus.sync.conflictCopies.join(", ")}.
                        Resolve them manually so future syncs stay clean.
                      </p>
                    )}
                  </div>
                  <SettingsActions>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void runSyncNow()}
                      disabled={syncBusy}
                    >
                      {syncBusy ? "Syncing…" : "Sync now"}
                    </button>
                  </SettingsActions>
                </>
              ) : (
                <>
                  <div
                    className="settings-data-status settings-data-status--error"
                    role="alert"
                  >
                    <p className="settings-data-status__path-row">
                      <strong>Backup folder:</strong>{" "}
                      <code>{dataStatus.sync.backupFolderPath}</code>
                    </p>
                    {dataStatus.sync.folderError && (
                      <p className="settings-import-status__errors">
                        {dataStatus.sync.folderError}
                      </p>
                    )}
                  </div>
                  <SettingsActions>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void pickBackupFolder()}
                    >
                      Choose folder…
                    </button>
                    {defaultBackupPath && (
                      <button type="button" className="btn" onClick={() => void useDefaultBackupFolder()}>
                        Use iCloud Drive default
                      </button>
                    )}
                  </SettingsActions>
                </>
              )}
              {syncConflict && !showSyncReview && (
                <div className="settings-sync-conflict" role="alert">
                  <p>
                    Both this device and the backup folder have changes since your last sync.
                  </p>
                  <SettingsActions>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setShowSyncReview(true)}
                      disabled={syncBusy}
                    >
                      Review &amp; merge
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void resolveSyncConflict("pull")}
                      disabled={syncBusy}
                    >
                      Use backup
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void resolveSyncConflict("push")}
                      disabled={syncBusy}
                    >
                      Keep this device
                    </button>
                  </SettingsActions>
                  <SettingsHint flush>
                    Review &amp; merge lets you combine conversations, tasks, notes, and other
                    files file-by-file. Quick actions overwrite one side entirely.
                  </SettingsHint>
                </div>
              )}
              {syncConflict && showSyncReview && (
                <SyncConflictReviewPanel
                  busy={syncBusy}
                  onApplyMerge={applySyncMerge}
                  onCancel={() => setShowSyncReview(false)}
                />
              )}
              {syncMessage && <SettingsHint flush>{syncMessage}</SettingsHint>}
            </SettingsGroup>

            <SettingsGroup
              title="Import from ChatGPT"
              description="Choose the folder from an unzipped ChatGPT export."
            >
              <SettingsActions>
                <button
                  type="button"
                  className="btn"
                  onClick={runImport}
                  disabled={importing}
                >
                  {importing ? "Importing…" : "Import"}
                </button>
              </SettingsActions>
              {importStatus != null && (
                <div className="settings-import-status" role="status">
                  {importStatus.imported > 0 && (
                    <p className="settings-import-status__ok">
                      Imported {importStatus.imported} conversation{importStatus.imported !== 1 ? "s" : ""}.
                    </p>
                  )}
                  {importStatus.errors.length > 0 && (
                    <div className="settings-import-status__errors">
                      <p>Errors:</p>
                      <ul>
                        {importStatus.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </SettingsGroup>

            <SettingsGroup
              title="Import from Claude"
              description={
                <>
                  Choose the folder from Claude.ai&apos;s &ldquo;Export data&rdquo; archive (contains{" "}
                  <code>conversations.json</code>). Re-imports skip threads already added.
                </>
              }
            >
              <SettingsActions>
                <button
                  type="button"
                  className="btn"
                  data-testid="settings-claude-import"
                  onClick={runClaudeImport}
                  disabled={claudeImporting}
                >
                  {claudeImporting ? "Importing…" : "Import"}
                </button>
              </SettingsActions>
              {claudeImportStatus != null && (
                <div className="settings-import-status" role="status">
                  {claudeImportStatus.imported > 0 && (
                    <p className="settings-import-status__ok">
                      Imported {claudeImportStatus.imported} conversation
                      {claudeImportStatus.imported !== 1 ? "s" : ""}.
                    </p>
                  )}
                  {claudeImportStatus.errors.length > 0 && (
                    <div className="settings-import-status__errors">
                      <p>Errors:</p>
                      <ul>
                        {claudeImportStatus.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </SettingsGroup>

          </section>}
        </div>
        </SettingsSwitchProvider>
      </div>
    </div>
  );
}
