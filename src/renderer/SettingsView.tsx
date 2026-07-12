import { useState, useEffect, useMemo, useRef, useCallback, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Settings as SettingsIcon } from "lucide-react";
import { RIG_PAGE_TITLE } from "../shared/rigPage";
import { LLM_CONTEXT_EXPORT_PROMPT } from "../shared/memoryImport";
import {
  MEMORY_INJECTION_STRATEGY_OPTIONS,
  type MemoryInjectionStrategy,
} from "../shared/memoryInjection";
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS } from "../shared/types";
import type { LayoutOptions, Settings, TranscriptDictionaryEntry } from "../shared/types";
import { appDataFolderButtonLabel } from "../shared/dataStorageLayout";
import type { SyncStatus } from "../shared/sync";
import { syncResultChangedLocalData, syncNowButtonTooltip, syncInlineStatusLine } from "../shared/sync";
import {
  DEFAULT_NOTE_TEMPLATES,
  NOTE_TEMPLATE_CURSOR_TOKEN,
  NOTE_TEMPLATE_TODAY_TOKEN,
  normalizeNoteTemplateDescription,
  normalizeNoteTemplates,
  type NoteTemplateConfig,
} from "../shared/writing";
import type { GlobalRecordingStatus } from "../shared/desktopAPI";
import { isRecordingReady } from "./recordingBootstrap";
import { Modal } from "./Modal";
import { Tooltip } from "./Tooltip";
import { useScrolledHeader } from "./useScrolledHeader";
import { WorkspaceHeader } from "./WorkspaceHeader";
import {
  SettingsActions,
  SettingsEntryRow,
  SettingsField,
  SettingsGroup,
  SettingsHint,
  SecretField,
  SettingsSwitch,
  SettingsSwitchProvider,
  SettingsTabPanel,
  SystemPromptPreviewPanel,
} from "./settings";
import type { SettingsTabId } from "./settings/settingsNavConfig";
import { normalizeSettingsTab, SETTINGS_TABS } from "./settings/settingsNavConfig";

interface SettingsViewProps {
  /** After ChatGPT import (new conversations in sidebar). */
  onImportComplete?: () => void;
  /** After sync pull/merge (sidebar list may have changed). */
  onSyncComplete?: () => void;
  /** Open a specific tab when the view mounts (e.g. from first-run setup). */
  initialTab?: SettingsTabId;
  /** Fires after debounced settings autosave completes. */
  onSettingsChanged?: () => void;
}

const SAVE_DEBOUNCE_MS = 500;
const SECRETS_SAVE_DEBOUNCE_MS = 150;
const SAVED_TOAST_VISIBLE_MS = 3000;

type PersistedFormState = {
  apiKey: string;
  tavilyApiKey: string;
  r2SecretAccessKey: string;
  autoSend: boolean;
  globalFnHotkey: boolean;
  openToComposeOnLaunch: boolean;
  cleanupEnabled: boolean;
  cleanupPrompt: string;
  transcriptDictionary: TranscriptDictionaryEntry[];
  weatherZip: string;
  memoryInjectionStrategy: MemoryInjectionStrategy;
  r2AccountId: string;
  r2Bucket: string;
  r2Prefix: string;
  r2AccessKeyId: string;
};

function serializeFormState(state: PersistedFormState): string {
  return JSON.stringify(state);
}

const D = DEFAULT_SETTINGS;

type SaveStatus = "idle" | "saving" | "saved" | "error";

function SettingsSaveToast({
  status,
}: {
  status: SaveStatus;
}) {
  const open = status !== "idle";
  const label =
    status === "saving" ? "Saving…" : status === "error" ? "Could not save settings" : "Saved";
  return createPortal(
    <div
      className="settings-toast"
      data-testid="settings-toast"
      data-status={status}
      role="status"
      aria-live="polite"
      aria-hidden={!open}
      style={{ display: open ? "block" : "none" }}
    >
      {label}
    </div>,
    document.body,
  );
}

export function SettingsView({
  onImportComplete,
  onSyncComplete,
  initialTab,
  onSettingsChanged,
}: SettingsViewProps) {
  const [apiKey, setApiKey] = useState(D.openai?.apiKey ?? "");
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
  const [globalFnHotkey, setGlobalFnHotkey] = useState(D.recording!.globalFnHotkey);
  const [openToComposeOnLaunch, setOpenToComposeOnLaunch] = useState(D.chat!.openToComposeOnLaunch);
  const [weatherZip, setWeatherZip] = useState(D.weather!.defaultZip);
  const [tavilyApiKey, setTavilyApiKey] = useState(D.search?.tavilyApiKey ?? "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [memoryInjectionStrategy, setMemoryInjectionStrategy] = useState<MemoryInjectionStrategy>(
    D.memory!.injectionStrategy
  );
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
  const [llmImportDraft, setLlmImportDraft] = useState("");
  const [llmImportBusy, setLlmImportBusy] = useState(false);
  const [llmImportMessage, setLlmImportMessage] = useState<string | null>(null);
  const [exportPromptOpen, setExportPromptOpen] = useState(false);
  const [cleanupLegacyBusy, setCleanupLegacyBusy] = useState(false);
  const [cleanupLegacyMessage, setCleanupLegacyMessage] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncTestBusy, setSyncTestBusy] = useState(false);
  const [r2TestError, setR2TestError] = useState<string | null>(null);
  const [r2AccountId, setR2AccountId] = useState(D.sync!.accountId);
  const [r2Bucket, setR2Bucket] = useState(D.sync!.bucket);
  const [r2Prefix, setR2Prefix] = useState(D.sync!.prefix);
  const [r2AccessKeyId, setR2AccessKeyId] = useState(D.sync!.accessKeyId);
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState("");
  const [dataStatus, setDataStatus] = useState<{
    localDataDir: string;
    appStateDir: string;
    localDataExists: boolean;
    conversationsCount: number;
    messageFilesCount: number;
    notesFilesCount: number;
    hasSettingsFile: boolean;
    recordingsDir: string;
    recordingsLocalOnly: true;
    legacyMemoryDir: string;
    legacyMemoryExists: boolean;
    sync: SyncStatus;
  } | null>(null);
  const platform = useMemo((): NodeJS.Platform => {
    if (typeof navigator === "undefined") return "linux";
    if (navigator.platform.startsWith("Mac")) return "darwin";
    if (navigator.userAgent.includes("Windows")) return "win32";
    return "linux";
  }, []);
  const isMac = platform === "darwin";
  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [globalRecordingStatus, setGlobalRecordingStatus] = useState<GlobalRecordingStatus | null>(
    null,
  );
  const [layoutOptions, setLayoutOptions] = useState<LayoutOptions>(DEFAULT_LAYOUT);
  const settingsHydratedRef = useRef(false);
  const skipAutosaveRef = useRef(false);
  const lastPersistedRef = useRef("");
  const hideToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistSettingsRef = useRef<() => Promise<boolean>>(async () => true);
  const flushSettingsOnUnmountRef = useRef(false);
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();
  const tabButtonRefs = useRef<Record<SettingsTabId, HTMLButtonElement | null>>({
    general: null,
    appearance: null,
    voice: null,
    memory: null,
    data: null,
  });
  const [activeTab, setActiveTab] = useState<SettingsTabId>(normalizeSettingsTab(initialTab));

  useEffect(() => {
    if (initialTab) setActiveTab(normalizeSettingsTab(initialTab));
  }, [initialTab]);

  useEffect(() => {
    let cancelled = false;
    const enableSwitchAnimations = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setSwitchAnimationsReady(true);
        });
      });
    };
    void Promise.all([
      window.harness.settings.get(),
      window.harness.credentials.getSecretsForSettings(),
    ])
      .then(([s, secrets]) => {
        if (cancelled) return;
        skipAutosaveRef.current = true;
        const S = s as Settings;
        const hydrated: PersistedFormState = {
          apiKey: secrets.openaiApiKey,
          tavilyApiKey: secrets.tavilyApiKey,
          r2SecretAccessKey: secrets.r2SecretAccessKey,
          autoSend: S.recording?.autoSend ?? D.recording!.autoSend,
          globalFnHotkey: S.recording?.globalFnHotkey ?? D.recording!.globalFnHotkey,
          openToComposeOnLaunch:
            S.chat?.openToComposeOnLaunch ??
            (S.chat as { composeFirst?: boolean } | undefined)?.composeFirst ??
            D.chat!.openToComposeOnLaunch,
          cleanupEnabled: S.transcription?.cleanup?.enabled ?? D.transcription?.cleanup?.enabled ?? false,
          cleanupPrompt: S.transcription?.cleanup?.prompt ?? D.transcription?.cleanup?.prompt ?? "",
          transcriptDictionary: S.transcription?.dictionary ?? D.transcription?.dictionary ?? [],
          weatherZip: S.weather?.defaultZip ?? D.weather!.defaultZip,
          memoryInjectionStrategy: S.memory?.injectionStrategy ?? D.memory!.injectionStrategy,
          r2AccountId: S.sync?.accountId ?? D.sync!.accountId,
          r2Bucket: S.sync?.bucket ?? D.sync!.bucket,
          r2Prefix: S.sync?.prefix ?? D.sync!.prefix,
          r2AccessKeyId: S.sync?.accessKeyId ?? D.sync!.accessKeyId,
        };
        setApiKey(hydrated.apiKey);
        setTavilyApiKey(hydrated.tavilyApiKey);
        setR2SecretAccessKey(hydrated.r2SecretAccessKey);
        setAutoSend(hydrated.autoSend);
        setGlobalFnHotkey(hydrated.globalFnHotkey);
        setOpenToComposeOnLaunch(hydrated.openToComposeOnLaunch);
        setCleanupEnabled(hydrated.cleanupEnabled);
        setCleanupPrompt(hydrated.cleanupPrompt);
        setCleanupPromptDraft(hydrated.cleanupPrompt);
        setTranscriptDictionary(hydrated.transcriptDictionary);
        setWeatherZip(hydrated.weatherZip);
        setR2AccountId(hydrated.r2AccountId);
        setR2Bucket(hydrated.r2Bucket);
        setR2Prefix(hydrated.r2Prefix);
        setR2AccessKeyId(hydrated.r2AccessKeyId);
        setMemoryInjectionStrategy(hydrated.memoryInjectionStrategy);
        setNoteTemplates(normalizeNoteTemplates(S.notes?.templates));
        lastPersistedRef.current = serializeFormState(hydrated);
      })
      .finally(() => {
        if (!cancelled) settingsHydratedRef.current = true;
        enableSwitchAnimations();
      });
    window.harness.memory.getUserMemory().then(setUserMemory);
    window.harness.customization.getLayoutOptions().then(setLayoutOptions);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isMac) return;
    void window.harness.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
  }, [isMac]);

  const refreshGlobalRecordingStatus = useCallback(async () => {
    setMicReady(isRecordingReady());
    try {
      const status = await window.harness.recording.getGlobalStatus();
      setGlobalRecordingStatus(status);
    } catch {
      setGlobalRecordingStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!isMac || activeTab !== "voice") return;
    void refreshGlobalRecordingStatus();
    const timer = setInterval(() => {
      setMicReady(isRecordingReady());
      void refreshGlobalRecordingStatus();
    }, 3000);
    return () => clearInterval(timer);
  }, [activeTab, isMac, refreshGlobalRecordingStatus]);

  useEffect(() => {
    if (activeTab !== "data") return;
    void refreshDataStatus();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "data" || !dataStatus?.sync.configured) return;
    const timer = setInterval(() => {
      void refreshDataStatus();
    }, 15_000);
    return () => clearInterval(timer);
  }, [activeTab, dataStatus?.sync.configured]);

  useEffect(() => {
    if (activeTab !== "memory") return;
    void refreshCompileStatus();
  }, [activeTab]);

  useEffect(() => {
    const unsub = window.harness.customization.onUpdated((payload) => {
      if (payload.type === "layout") {
        void window.harness.customization.getLayoutOptions().then(setLayoutOptions);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    return () => {
      if (hideToastRef.current) clearTimeout(hideToastRef.current);
    };
  }, []);

  const persistSettings = useCallback(async (): Promise<boolean> => {
    const latest = serializeFormState({
      apiKey,
      tavilyApiKey,
      r2SecretAccessKey,
      autoSend,
      globalFnHotkey,
      openToComposeOnLaunch,
      cleanupEnabled,
      cleanupPrompt,
      transcriptDictionary,
      weatherZip,
      memoryInjectionStrategy,
      r2AccountId,
      r2Bucket,
      r2Prefix,
      r2AccessKeyId,
    });
    if (latest === lastPersistedRef.current) {
      if (hideToastRef.current) clearTimeout(hideToastRef.current);
      setSaveStatus("saved");
      hideToastRef.current = setTimeout(() => {
        setSaveStatus("idle");
        hideToastRef.current = null;
      }, SAVED_TOAST_VISIBLE_MS);
      return true;
    }

    const prev = JSON.parse(lastPersistedRef.current || "{}") as Partial<PersistedFormState>;
    const next = JSON.parse(latest) as PersistedFormState;

    if (hideToastRef.current) clearTimeout(hideToastRef.current);
    setSaveStatus("saving");

    try {
      if (next.apiKey !== (prev.apiKey ?? "")) {
        await window.harness.credentials.setOpenAIApiKey(next.apiKey.trim());
      }
      if (next.tavilyApiKey !== (prev.tavilyApiKey ?? "")) {
        await window.harness.credentials.setTavilyApiKey(next.tavilyApiKey.trim());
      }
      if (next.r2SecretAccessKey !== (prev.r2SecretAccessKey ?? "")) {
        await window.harness.credentials.setR2SecretAccessKey(next.r2SecretAccessKey.trim());
      }
      await window.harness.settings.set({
        recording: { autoSend: next.autoSend, globalFnHotkey: next.globalFnHotkey },
        chat: { openToComposeOnLaunch: next.openToComposeOnLaunch },
        transcription: {
          cleanup: {
            enabled: next.cleanupEnabled,
            prompt: next.cleanupPrompt,
          },
          dictionary: next.transcriptDictionary,
        },
        weather: {
          defaultZip: next.weatherZip.trim(),
        },
        memory: {
          injectionStrategy: next.memoryInjectionStrategy,
        },
        sync: {
          accountId: next.r2AccountId.trim(),
          bucket: next.r2Bucket.trim(),
          prefix: next.r2Prefix.trim() || D.sync!.prefix,
          accessKeyId: next.r2AccessKeyId.trim(),
        },
      });
      const r2Changed =
        next.r2AccountId !== prev.r2AccountId ||
        next.r2Bucket !== prev.r2Bucket ||
        next.r2Prefix !== prev.r2Prefix ||
        next.r2AccessKeyId !== prev.r2AccessKeyId ||
        next.r2SecretAccessKey !== prev.r2SecretAccessKey;
      if (r2Changed) setDataStatus(await window.harness.memory.getDataStatus());
      lastPersistedRef.current = latest;
      setSaveStatus("saved");
      onSettingsChanged?.();
      hideToastRef.current = setTimeout(() => {
        setSaveStatus("idle");
        hideToastRef.current = null;
      }, SAVED_TOAST_VISIBLE_MS);
      return true;
    } catch (err) {
      console.error("[Settings] save failed", err);
      setSaveStatus("error");
      hideToastRef.current = setTimeout(() => {
        setSaveStatus("idle");
        hideToastRef.current = null;
      }, SAVED_TOAST_VISIBLE_MS);
      return false;
    }
  }, [
    apiKey,
    autoSend,
    globalFnHotkey,
    openToComposeOnLaunch,
    cleanupEnabled,
    cleanupPrompt,
    transcriptDictionary,
    weatherZip,
    tavilyApiKey,
    memoryInjectionStrategy,
    r2AccountId,
    r2Bucket,
    r2Prefix,
    r2AccessKeyId,
    r2SecretAccessKey,
    onSettingsChanged,
  ]);

  persistSettingsRef.current = persistSettings;

  useEffect(() => {
    return () => {
      if (flushSettingsOnUnmountRef.current && settingsHydratedRef.current) {
        void persistSettingsRef.current();
      }
    };
  }, []);

  useEffect(() => {
    if (!settingsHydratedRef.current) return;
    flushSettingsOnUnmountRef.current = true;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    const current = serializeFormState({
      apiKey,
      tavilyApiKey,
      r2SecretAccessKey,
      autoSend,
      globalFnHotkey,
      openToComposeOnLaunch,
      cleanupEnabled,
      cleanupPrompt,
      transcriptDictionary,
      weatherZip,
      memoryInjectionStrategy,
      r2AccountId,
      r2Bucket,
      r2Prefix,
      r2AccessKeyId,
    });
    if (current === lastPersistedRef.current) return;

    const timer = setTimeout(() => {
      void persistSettings();
    }, SECRETS_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [apiKey, tavilyApiKey, r2SecretAccessKey, persistSettings]);

  useEffect(() => {
    if (!settingsHydratedRef.current) return;
    flushSettingsOnUnmountRef.current = true;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    const current = serializeFormState({
      apiKey,
      tavilyApiKey,
      r2SecretAccessKey,
      autoSend,
      globalFnHotkey,
      openToComposeOnLaunch,
      cleanupEnabled,
      cleanupPrompt,
      transcriptDictionary,
      weatherZip,
      memoryInjectionStrategy,
      r2AccountId,
      r2Bucket,
      r2Prefix,
      r2AccessKeyId,
    });
    if (current === lastPersistedRef.current) return;

    const timer = setTimeout(() => {
      void persistSettings();
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    autoSend,
    globalFnHotkey,
    openToComposeOnLaunch,
    cleanupEnabled,
    cleanupPrompt,
    transcriptDictionary,
    weatherZip,
    memoryInjectionStrategy,
    r2AccountId,
    r2Bucket,
    r2Prefix,
    r2AccessKeyId,
    persistSettings,
  ]);

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
    await window.harness.settings.set({ notes: { templates: normalized } });
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
      await window.harness.memory.deleteUserMemoryKey(editingMemoryKey);
    }
    await window.harness.memory.setUserMemory(nextTitle, nextDetail);
    setUserMemory(await window.harness.memory.getUserMemory());
    closeMemoryModal();
  };

  const deleteMemoryEntry = async (key: string) => {
    await window.harness.memory.deleteUserMemoryKey(key);
    setUserMemory(await window.harness.memory.getUserMemory());
  };

  const refreshDataStatus = async () => {
    const status = await window.harness.memory.getDataStatus();
    setDataStatus(status);
  };

  const runCleanupLegacyMemory = async () => {
    setCleanupLegacyBusy(true);
    setCleanupLegacyMessage(null);
    try {
      const result = await window.harness.memory.cleanupLegacyMemory();
      setCleanupLegacyMessage(result.removed ? "Removed legacy memory folder." : "No legacy memory folder to remove.");
      await refreshDataStatus();
    } finally {
      setCleanupLegacyBusy(false);
    }
  };

  const runSyncNow = async () => {
    setSyncBusy(true);
    try {
      const result = await window.harness.sync.runNow();
      await refreshDataStatus();
      if (syncResultChangedLocalData(result)) {
        onSyncComplete?.();
      }
    } finally {
      setSyncBusy(false);
    }
  };

  const testR2Connection = async () => {
    setSyncTestBusy(true);
    setR2TestError(null);
    try {
      const result = await window.harness.sync.testConnection();
      if (result.ok) {
        await refreshDataStatus();
      } else {
        setR2TestError(result.error ?? "Connection failed.");
      }
    } finally {
      setSyncTestBusy(false);
    }
  };

  const syncTooltip = syncNowButtonTooltip({
    busy: syncBusy,
    configured: dataStatus?.sync.configured ?? false,
  });

  const syncInlineStatus =
    dataStatus?.sync.configured && !dataStatus.sync.lastError
      ? syncBusy
        ? "Syncing…"
        : syncInlineStatusLine({ lastSuccessAt: dataStatus.sync.lastSuccessAt ?? null })
      : null;

  const runImport = async () => {
    setImporting(true);
    setImportStatus(null);
    try {
      const result = await window.harness.memory.importFromChatGPTFolder();
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
      const result = await window.harness.memory.importFromClaudeFolder();
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
    const status = await window.harness.memory.getCompileStatus();
    setCompileStatus(status);
  };

  const copyExportPrompt = async () => {
    try {
      await navigator.clipboard.writeText(LLM_CONTEXT_EXPORT_PROMPT);
      setLlmImportMessage("Export prompt copied to clipboard.");
    } catch {
      setLlmImportMessage("Could not copy to clipboard.");
    }
  };

  const runLlmContextImport = async () => {
    setLlmImportBusy(true);
    setLlmImportMessage(null);
    try {
      const response = await window.harness.memory.importLlmContext(llmImportDraft);
      if (response.ok) {
        const r = response.result;
        const parts = [`Added ${r.added}, updated ${r.updated}.`];
        if (r.importSource) parts.push(`Source: ${r.importSource}.`);
        if (r.truncated) parts.push("Export was truncated before processing.");
        setLlmImportMessage(parts.join(" "));
        setLlmImportDraft("");
        setUserMemory(await window.harness.memory.getUserMemory());
      } else {
        setLlmImportMessage(response.error);
      }
    } finally {
      setLlmImportBusy(false);
    }
  };

  const runCompileNow = async () => {
    setCompileBusy(true);
    setCompileMessage(null);
    try {
      const response = await window.harness.memory.runCompileNow();
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
      setUserMemory(await window.harness.memory.getUserMemory());
    } finally {
      setCompileBusy(false);
    }
  };

  const updateLayoutOptions = (patch: Partial<LayoutOptions>) => {
    setLayoutOptions((prev) => ({ ...prev, ...patch }));
    void window.harness.customization.setLayout(patch);
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
        icon={<SettingsIcon size={16} />}
        scrolled={headerScrolled}
        actions={
          <div
            className="settings-tabs settings-tabs--header"
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
      <div ref={scrollRef} className="workspace-scroll settings-scroll" onScroll={onScroll}>
        <SettingsSwitchProvider animationsReady={switchAnimationsReady}>
        <div className="workspace-content settings-content">
          {activeTab === "general" && <SettingsTabPanel id="general">
            <SettingsGroup title="OpenAI" description="API key for chat. Voice transcription runs on your Mac.">
              <SecretField
                id="settings-api-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={() => void persistSettings()}
                placeholder="sk-…"
                ariaLabel="OpenAI API key"
              />
            </SettingsGroup>

            <SettingsGroup
              title="Web search tool"
              description={
                <>
                  API key for the <code>web_search</code> tool. Get a free key at{" "}
                  <a href="https://tavily.com" target="_blank" rel="noreferrer noopener">tavily.com</a>.
                </>
              }
            >
              <SettingsField label="Tavily API key" htmlFor="settings-tavily-key">
                <SecretField
                  id="settings-tavily-key"
                  testId="settings-tavily-key"
                  value={tavilyApiKey}
                  onChange={(e) => setTavilyApiKey(e.target.value)}
                  onBlur={() => void persistSettings()}
                  placeholder="tvly-…"
                  ariaLabel="Tavily API key"
                />
              </SettingsField>
            </SettingsGroup>

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

            <SettingsGroup
              title="Facts in chat"
              description="Choose how stored facts are included when you send a message."
            >
              <select
                id="settings-memory-injection"
                data-testid="settings-memory-injection"
                value={memoryInjectionStrategy}
                onChange={(e) =>
                  setMemoryInjectionStrategy(e.target.value as MemoryInjectionStrategy)
                }
                aria-label="When to include facts in chat"
              >
                {MEMORY_INJECTION_STRATEGY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <SettingsHint flush>
                {
                  MEMORY_INJECTION_STRATEGY_OPTIONS.find((o) => o.id === memoryInjectionStrategy)
                    ?.description
                }
              </SettingsHint>
            </SettingsGroup>

            <SettingsGroup
              title="Launch & sending"
              description="Startup view and what happens after voice dictation."
            >
              <SettingsSwitch
                id="openToComposeOnLaunchToggle"
                testId="settings-open-to-compose-on-launch"
                label="Open to compose on launch"
                checked={openToComposeOnLaunch}
                onChange={(e) => setOpenToComposeOnLaunch(e.target.checked)}
              />
              <SettingsSwitch
                id="autoSendToggle"
                testId="settings-auto-send"
                label="Auto-send after dictation"
                checked={autoSend}
                onChange={(e) => setAutoSend(e.target.checked)}
              />
            </SettingsGroup>
          </SettingsTabPanel>}

          {activeTab === "appearance" && <SettingsTabPanel id="appearance">
            <SettingsGroup
              title="Grid overlay"
              description="Optional visual grid for alignment checks while designing screens. Overlay is visual only and does not capture clicks."
            >
              <select
                id="settings-grid-overlay"
                data-testid="settings-grid-overlay"
                value={layoutOptions.gridOverlay}
                onChange={(e) =>
                  updateLayoutOptions({
                    gridOverlay: e.target.value as LayoutOptions["gridOverlay"],
                  })
                }
                aria-label="Grid overlay"
              >
                <option value="off">Off</option>
                <option value="4">4px grid</option>
                <option value="8">8px grid</option>
                <option value="16">16px grid</option>
              </select>
            </SettingsGroup>

            <SettingsGroup
              title="Editor templates"
              description="Edit the three note templates shown on the Editor overview page."
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
          </SettingsTabPanel>}

          {activeTab === "voice" && <SettingsTabPanel id="voice">
            {isMac ? (
              <SettingsGroup
                title="On-device transcription"
                description="Voice dictation uses Apple's Speech framework on this Mac. No model download is required."
              >
                <SettingsHint>
                  Enable Speech Recognition for Harness in System Settings if prompted. On macOS versions before 26,
                  also install the dictation language under Keyboard → Dictation.
                </SettingsHint>
              </SettingsGroup>
            ) : null}

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
                    Edit Prompt
                  </button>
                </SettingsActions>
              ) : null}
              {cleanupEnabled && !apiKey.trim() ? (
                <SettingsHint>
                  Cleanup needs an OpenAI API key in General. On-device transcription still works without one.
                </SettingsHint>
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
                  Add Correction
                </button>
              </SettingsActions>
            </SettingsGroup>

            <SettingsGroup
              title="Recordings"
              description="Saved WAV files from voice dictation on this device."
            >
              <SettingsActions>
                <button
                  type="button"
                  className="btn"
                  onClick={() => window.harness.recording.openFolder()}
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
                <SettingsSwitch
                  id="globalFnHotkeyToggle"
                  testId="settings-global-fn-hotkey"
                  label="Menu bar shortcut"
                  checked={globalFnHotkey}
                  onChange={(e) => setGlobalFnHotkey(e.target.checked)}
                />
                {globalFnHotkey && (
                  <>
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
                            void window.harness.system.requestAccessibilityPrompt();
                            setTimeout(() => {
                              void window.harness.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
                            }, 800);
                          }}
                        >
                          Ask For Permission <ExternalLink size={14} aria-hidden />
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn"
                        data-testid="settings-open-accessibility"
                        onClick={() => {
                          void window.harness.system.openAccessibilitySettings();
                          setTimeout(() => {
                            void window.harness.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
                          }, 1500);
                        }}
                      >
                        Open Accessibility <ExternalLink size={14} aria-hidden />
                      </button>
                    </SettingsActions>
                    <SettingsHint flush>
                      {accessibilityTrusted === true
                        ? "Accessibility looks good. If Fn still won’t work, restart and check both Harness and Fn Monitor."
                        : accessibilityTrusted === false
                          ? "Accessibility not enabled yet."
                          : "Checking…"}
                    </SettingsHint>
                    <SettingsHint flush data-testid="settings-global-recording-status">
                      Fn monitor:{" "}
                      {globalRecordingStatus?.monitorHealth === "running"
                        ? "running"
                        : globalRecordingStatus?.monitorHealth === "accessibility_denied"
                          ? "needs Accessibility"
                          : globalRecordingStatus?.hotkeyActive
                            ? "starting…"
                            : "off"}
                      {" · "}
                      Microphone: {micReady ? "ready" : "not primed — click anywhere in Harness or use the in-app mic once"}
                    </SettingsHint>
                  </>
                )}
              </SettingsGroup>
            )}
          </SettingsTabPanel>}

          {activeTab === "memory" && <SettingsTabPanel id="memory">
            <SystemPromptPreviewPanel memoryInjectionStrategy={memoryInjectionStrategy} />

            <SettingsGroup
              title="Your facts"
              description="Stable facts stored locally and synced with your backup. Pick a short label and a one-line value; the same label updates the existing entry."
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
                  Add Entry
                </button>
              </SettingsActions>
            </SettingsGroup>

            <SettingsGroup
              title="Import from another assistant"
              description={
                <>
                  Run the export prompt in ChatGPT, Claude, or another assistant, paste the result
                  below, then import. Harness uses your OpenAI API key to distill entries into your
                  facts above (same merge rules as learn from past chats).
                </>
              }
            >
              <SettingsActions>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setExportPromptOpen((open) => !open)}
                  aria-expanded={exportPromptOpen}
                >
                  {exportPromptOpen ? "Hide Export Prompt" : "Show Export Prompt"}
                </button>
                <button type="button" className="btn" onClick={() => void copyExportPrompt()}>
                  Copy Export Prompt
                </button>
              </SettingsActions>
              {exportPromptOpen && (
                <label className="app-modal-field">
                  <span className="app-modal-field__label">Export prompt</span>
                  <textarea
                    readOnly
                    value={LLM_CONTEXT_EXPORT_PROMPT}
                    className="app-modal-input app-modal-input--multiline settings-llm-import-prompt"
                    rows={12}
                    aria-label="Export prompt for other assistants"
                  />
                </label>
              )}
              <label className="app-modal-field">
                <span className="app-modal-field__label">Pasted export</span>
                <textarea
                  placeholder="Paste the structured export from the other assistant…"
                  value={llmImportDraft}
                  onChange={(e) => setLlmImportDraft(e.target.value)}
                  className="app-modal-input app-modal-input--multiline settings-llm-import-export"
                  rows={14}
                  data-testid="settings-llm-import-export"
                />
              </label>
              <SettingsActions>
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="settings-import-llm-context"
                  onClick={() => void runLlmContextImport()}
                  disabled={llmImportBusy || !llmImportDraft.trim()}
                >
                  {llmImportBusy ? "Importing…" : "Import Facts"}
                </button>
              </SettingsActions>
              {llmImportMessage && <SettingsHint flush>{llmImportMessage}</SettingsHint>}
            </SettingsGroup>

            <SettingsGroup
              title="Learn from past chats"
              description={
                <>
                  Reviews conversations updated since the last run and adds durable facts to your
                  facts above. Uses your OpenAI API key. Auto-merges without asking — edit or remove
                  entries any time. Manual-only for now; runs only when you press the button below.
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
                  {compileBusy ? "Learning…" : "Learn Now"}
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
          </SettingsTabPanel>}

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
                  Reset To Default
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
                  placeholder="Describe how dictation should be cleaned up."
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
                  placeholder="e.g. wig em"
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
            <div className="app-modal-stack">
              <label className="app-modal-field">
                <span className="app-modal-field__label">Label</span>
                <input
                  type="text"
                  placeholder="e.g. timezone"
                  value={newMemTitle}
                  onChange={(e) => setNewMemTitle(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
              <label className="app-modal-field">
                <span className="app-modal-field__label">Detail</span>
                <textarea
                  placeholder="What to remember"
                  value={newMemDetail}
                  onChange={(e) => setNewMemDetail(e.target.value)}
                  className="app-modal-input app-modal-input--multiline"
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
            <div className="app-modal-stack">
              <label className="app-modal-field">
                <span className="app-modal-field__label">Title</span>
                <input
                  type="text"
                  value={templateTitleDraft}
                  onChange={(e) => setTemplateTitleDraft(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
              <label className="app-modal-field">
                <span className="app-modal-field__label">Description</span>
                <input
                  type="text"
                  value={templateDescriptionDraft}
                  onChange={(e) => setTemplateDescriptionDraft(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
              <label className="app-modal-field">
                <span className="app-modal-field__label">Template body</span>
                <p className="app-modal-field__hint">
                  Use <code>{NOTE_TEMPLATE_TODAY_TOKEN}</code> for today&apos;s date and{" "}
                  <code>{NOTE_TEMPLATE_CURSOR_TOKEN}</code> to place the cursor when the note opens.
                </p>
                <textarea
                  value={templateContentDraft}
                  onChange={(e) => setTemplateContentDraft(e.target.value)}
                  className="app-modal-input app-modal-input--multiline settings-template-content-input"
                  rows={10}
                />
              </label>
            </div>
          </Modal>

          {activeTab === "data" && <SettingsTabPanel id="data">
            <SettingsGroup
              title="Local data"
              description="Harness stores conversations, notes, and settings on this device. Backup syncs everything except local recordings."
            >
              <SettingsActions>
                <button type="button" className="btn" onClick={() => window.harness.memory.openAppDataFolder()}>
                  {appDataFolderButtonLabel(platform)} <ExternalLink size={14} aria-hidden />
                </button>
                {dataStatus?.legacyMemoryExists && (
                  <button type="button" className="btn" onClick={() => void runCleanupLegacyMemory()} disabled={cleanupLegacyBusy}>
                    {cleanupLegacyBusy ? "Cleaning…" : "Clean Legacy Memory Folder"}
                  </button>
                )}
              </SettingsActions>
              {dataStatus?.legacyMemoryExists && cleanupLegacyMessage && (
                <SettingsHint flush>{cleanupLegacyMessage}</SettingsHint>
              )}
            </SettingsGroup>

            <SettingsGroup
              title="Backup (R2)"
              description={
                <>
                  Connect a Cloudflare R2 bucket. Harness stores <code>bundle.json.gz</code> and{" "}
                  <code>manifest.json</code> under the prefix below. Enable object versioning in R2 for
                  free backup history.
                </>
              }
            >
              <SettingsField label="Account ID" htmlFor="settings-r2-account">
                <input
                  id="settings-r2-account"
                  type="text"
                  value={r2AccountId}
                  onChange={(e) => setR2AccountId(e.target.value)}
                  placeholder="Cloudflare account ID"
                  autoComplete="off"
                  spellCheck={false}
                />
              </SettingsField>
              <SettingsField label="Bucket" htmlFor="settings-r2-bucket">
                <input
                  id="settings-r2-bucket"
                  type="text"
                  value={r2Bucket}
                  onChange={(e) => setR2Bucket(e.target.value)}
                  placeholder="harness-sync"
                  autoComplete="off"
                  spellCheck={false}
                />
              </SettingsField>
              <SettingsField label="Prefix" htmlFor="settings-r2-prefix">
                <input
                  id="settings-r2-prefix"
                  type="text"
                  value={r2Prefix}
                  onChange={(e) => setR2Prefix(e.target.value)}
                  placeholder="harness/"
                  autoComplete="off"
                  spellCheck={false}
                />
              </SettingsField>
              <SettingsField label="Access key ID" htmlFor="settings-r2-access-key-id">
                <input
                  id="settings-r2-access-key-id"
                  type="text"
                  value={r2AccessKeyId}
                  onChange={(e) => setR2AccessKeyId(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </SettingsField>
              <SettingsField label="Secret access key" htmlFor="settings-r2-secret">
                <SecretField
                  id="settings-r2-secret"
                  value={r2SecretAccessKey}
                  onChange={(e) => setR2SecretAccessKey(e.target.value)}
                  onBlur={() => void persistSettings()}
                  placeholder="Secret access key"
                  ariaLabel="R2 secret access key"
                />
              </SettingsField>
              {(dataStatus?.sync.lastError || r2TestError) && (
                <p className="settings-import-status__errors">
                  {dataStatus?.sync.lastError ?? r2TestError}
                </p>
              )}
              <SettingsActions>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void testR2Connection()}
                  disabled={syncTestBusy}
                >
                  {syncTestBusy ? "Testing…" : "Test Connection"}
                </button>
                <div className="settings-sync-control">
                  <Tooltip label={syncTooltip}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void runSyncNow()}
                      disabled={syncBusy || !dataStatus?.sync.configured}
                    >
                      {syncBusy ? "Syncing…" : "Sync Now"}
                    </button>
                  </Tooltip>
                  {syncInlineStatus ? (
                    <span className="settings-sync-status" role="status">
                      {syncInlineStatus}
                    </span>
                  ) : null}
                </div>
              </SettingsActions>
            </SettingsGroup>

            <SettingsGroup title="Import chat history">
              <details className="settings-import-details">
                <summary>Import chat history (optional)</summary>
                <p className="settings-group__lead settings-import-details__lead">
                  Bring conversations from ChatGPT or Claude exports into Harness. This is separate
                  from importing facts on the Memory tab.
                </p>
                <div className="settings-import-details__section">
                  <h4 className="settings-import-details__heading">ChatGPT</h4>
                  <p className="settings-group__hint">Choose the folder from an unzipped ChatGPT export.</p>
                  <SettingsActions>
                    <button
                      type="button"
                      className="btn"
                      onClick={runImport}
                      disabled={importing}
                    >
                      {importing ? "Importing…" : "Import From ChatGPT"}
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
                </div>
                <div className="settings-import-details__section">
                  <h4 className="settings-import-details__heading">Claude</h4>
                  <p className="settings-group__hint">
                    Choose the folder from Claude.ai&apos;s &ldquo;Export data&rdquo; archive (contains{" "}
                    <code>conversations.json</code>). Re-imports skip threads already added.
                  </p>
                  <SettingsActions>
                    <button
                      type="button"
                      className="btn"
                      data-testid="settings-claude-import"
                      onClick={runClaudeImport}
                      disabled={claudeImporting}
                    >
                      {claudeImporting ? "Importing…" : "Import From Claude"}
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
                </div>
              </details>
            </SettingsGroup>

          </SettingsTabPanel>}
        </div>
        </SettingsSwitchProvider>
      </div>
      <SettingsSaveToast status={saveStatus} />
    </div>
  );
}
