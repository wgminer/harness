import { useState, useEffect, useMemo, useRef, useCallback, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Settings as SettingsIcon } from "lucide-react";
import { RIG_PAGE_TITLE } from "../shared/rigPage";
import { DEFAULT_SETTINGS } from "../shared/types";
import type { Settings, TranscriptDictionaryEntry } from "../shared/types";
import { DEFAULT_ACCENT, applyAccent, normalizeAccentHex } from "../shared/accent";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
  DEFAULT_NOTE_TEMPLATES,
  NOTE_TEMPLATE_CURSOR_TOKEN,
  NOTE_TEMPLATE_TODAY_TOKEN,
  normalizeDefaultNoteTemplateId,
  normalizeNoteTemplates,
  type NoteTemplateConfig,
} from "../shared/writing";
import type { GlobalRecordingStatus } from "../shared/desktopAPI";
import { Modal } from "./Modal";
import { SyncQrModal } from "./SyncQrModal";
import { useScrolledHeader } from "./useScrolledHeader";
import { WorkspaceHeader } from "./WorkspaceHeader";
import {
  SettingsActions,
  SettingsEntryRow,
  SettingsGroup,
  SettingsHint,
  SettingsSwitch,
  SettingsSwitchProvider,
  SettingsTabPanel,
  DataSettingsTab,
  AccentColorField,
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
  /** When true, "New note" opens a windowed note instead of the main Editor. */
  openNoteInStickyWindow?: boolean;
  onOpenNoteInStickyWindowChange?: (value: boolean) => void;
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
  r2AccountId: string;
  r2Bucket: string;
  r2Prefix: string;
  r2AccessKeyId: string;
  accent: string;
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

function fnShortcutStatusLabel(
  accessibilityTrusted: boolean | null,
  status: GlobalRecordingStatus | null,
): string {
  const needs: string[] = [];
  if (
    accessibilityTrusted === false ||
    status?.monitorHealth === "accessibility_denied"
  ) {
    needs.push("Accessibility");
  }
  const mic = status?.microphonePermission;
  if (mic === "denied" || mic === "undetermined") {
    needs.push("Microphone");
  }
  if (needs.length > 0) return `Needs ${needs.join(" · ")}`;
  if (status?.monitorHealth === "running") return "Ready — press Fn to dictate";
  if (status?.hotkeyActive) return "Starting…";
  if (accessibilityTrusted === null || status == null) return "Checking…";
  return "On — quit and reopen if Fn doesn’t respond";
}

function FnShortcutControls({
  accessibilityTrusted,
  setAccessibilityTrusted,
  globalRecordingStatus,
  refreshGlobalRecordingStatus,
}: {
  accessibilityTrusted: boolean | null;
  setAccessibilityTrusted: (value: boolean | null) => void;
  globalRecordingStatus: GlobalRecordingStatus | null;
  refreshGlobalRecordingStatus: () => Promise<void>;
}) {
  const needsAccessibility =
    accessibilityTrusted !== true ||
    globalRecordingStatus?.monitorHealth === "accessibility_denied";
  const mic = globalRecordingStatus?.microphonePermission;
  const needsMicrophone = mic !== "granted" && mic !== "unsupported";
  const showActions = needsAccessibility || needsMicrophone;

  return (
    <div className="settings-fn-controls">
      <p className="settings-fn-controls__status" data-testid="settings-global-recording-status">
        {fnShortcutStatusLabel(accessibilityTrusted, globalRecordingStatus)}
      </p>
      {showActions ? (
        <SettingsActions>
          {needsAccessibility ? (
            <button
              type="button"
              className="btn"
              data-testid="settings-accessibility-prompt"
              onClick={() => {
                void window.harness.system.requestAccessibilityPrompt();
                void window.harness.system.openAccessibilitySettings();
                setTimeout(() => {
                  void window.harness.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
                }, 1200);
              }}
            >
              Accessibility <ExternalLink size={14} aria-hidden />
            </button>
          ) : null}
          {needsMicrophone ? (
            <button
              type="button"
              className="btn"
              data-testid="settings-microphone-prompt"
              onClick={() => {
                void window.harness.recording.requestMicrophoneAccess().then((ok) => {
                  void refreshGlobalRecordingStatus();
                  if (!ok) {
                    void window.harness.system.openMicrophoneSettings();
                  }
                });
              }}
            >
              Microphone <ExternalLink size={14} aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            data-testid="settings-open-speech-recognition"
            onClick={() => {
              void window.harness.system.openSpeechRecognitionSettings();
            }}
          >
            Speech <ExternalLink size={14} aria-hidden />
          </button>
        </SettingsActions>
      ) : null}
    </div>
  );
}

export function SettingsView({
  onImportComplete,
  onSyncComplete,
  initialTab,
  onSettingsChanged,
  openNoteInStickyWindow = false,
  onOpenNoteInStickyWindowChange,
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
  const [defaultNoteTemplateId, setDefaultNoteTemplateId] = useState(DEFAULT_NOTE_TEMPLATE_ID);
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateTitleDraft, setTemplateTitleDraft] = useState("");
  const [templateContentDraft, setTemplateContentDraft] = useState("");
  const [templateIsDefaultDraft, setTemplateIsDefaultDraft] = useState(false);

  const [autoSend, setAutoSend] = useState(true);
  const [globalFnHotkey, setGlobalFnHotkey] = useState(D.recording!.globalFnHotkey);
  const [openToComposeOnLaunch, setOpenToComposeOnLaunch] = useState(D.chat!.openToComposeOnLaunch);
  const [tavilyApiKey, setTavilyApiKey] = useState(D.search?.tavilyApiKey ?? "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [r2AccountId, setR2AccountId] = useState(D.sync!.accountId);
  const [r2Bucket, setR2Bucket] = useState(D.sync!.bucket);
  const [r2Prefix, setR2Prefix] = useState(D.sync!.prefix);
  const [r2AccessKeyId, setR2AccessKeyId] = useState(D.sync!.accessKeyId);
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState("");
  const [accent, setAccent] = useState(D.appearance?.accent ?? DEFAULT_ACCENT);
  const dataRefreshRef = useRef<(() => Promise<void>) | null>(null);
  const registerDataRefresh = useCallback((refresh: () => Promise<void>) => {
    dataRefreshRef.current = refresh;
  }, []);
  const platform = useMemo((): NodeJS.Platform => {
    if (typeof navigator === "undefined") return "linux";
    if (navigator.platform.startsWith("Mac")) return "darwin";
    if (navigator.userAgent.includes("Windows")) return "win32";
    return "linux";
  }, []);
  const isMac = platform === "darwin";
  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null);
  const [globalRecordingStatus, setGlobalRecordingStatus] = useState<GlobalRecordingStatus | null>(
    null,
  );
  const settingsHydratedRef = useRef(false);
  const skipAutosaveRef = useRef(false);
  const lastPersistedRef = useRef("");
  const hideToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistSettingsRef = useRef<() => Promise<boolean>>(async () => true);
  const flushSettingsOnUnmountRef = useRef(false);
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();
  const tabButtonRefs = useRef<Record<SettingsTabId, HTMLButtonElement | null>>({
    general: null,
    notes: null,
    voice: null,
    data: null,
  });
  const [activeTab, setActiveTab] = useState<SettingsTabId>(normalizeSettingsTab(initialTab));
  const [syncQrOpen, setSyncQrOpen] = useState(false);

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
          r2AccountId: S.sync?.accountId ?? D.sync!.accountId,
          r2Bucket: S.sync?.bucket ?? D.sync!.bucket,
          r2Prefix: S.sync?.prefix ?? D.sync!.prefix,
          r2AccessKeyId: S.sync?.accessKeyId ?? D.sync!.accessKeyId,
          accent: normalizeAccentHex(S.appearance?.accent ?? D.appearance?.accent),
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
        setR2AccountId(hydrated.r2AccountId);
        setR2Bucket(hydrated.r2Bucket);
        setR2Prefix(hydrated.r2Prefix);
        setR2AccessKeyId(hydrated.r2AccessKeyId);
        setAccent(hydrated.accent);
        applyAccent(hydrated.accent);
        setNoteTemplates(normalizeNoteTemplates(S.notes?.templates));
        setDefaultNoteTemplateId(
          normalizeDefaultNoteTemplateId(S.notes?.defaultTemplateId, normalizeNoteTemplates(S.notes?.templates)),
        );
        lastPersistedRef.current = serializeFormState(hydrated);
      })
      .finally(() => {
        if (!cancelled) settingsHydratedRef.current = true;
        enableSwitchAnimations();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isMac) return;
    void window.harness.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
  }, [isMac]);

  const refreshGlobalRecordingStatus = useCallback(async () => {
    try {
      const status = await window.harness.recording.getGlobalStatus();
      setGlobalRecordingStatus(status);
    } catch {
      setGlobalRecordingStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!isMac || activeTab !== "general" || !globalFnHotkey) return;
    void refreshGlobalRecordingStatus();
    const timer = setInterval(() => {
      void refreshGlobalRecordingStatus();
    }, 3000);
    return () => clearInterval(timer);
  }, [activeTab, globalFnHotkey, isMac, refreshGlobalRecordingStatus]);

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
      r2AccountId,
      r2Bucket,
      r2Prefix,
      r2AccessKeyId,
      accent,
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
        sync: {
          accountId: next.r2AccountId.trim(),
          bucket: next.r2Bucket.trim(),
          prefix: next.r2Prefix.trim() || D.sync!.prefix,
          accessKeyId: next.r2AccessKeyId.trim(),
        },
        appearance: { accent: normalizeAccentHex(next.accent) },
      });
      const r2Changed =
        next.r2AccountId !== prev.r2AccountId ||
        next.r2Bucket !== prev.r2Bucket ||
        next.r2Prefix !== prev.r2Prefix ||
        next.r2AccessKeyId !== prev.r2AccessKeyId ||
        next.r2SecretAccessKey !== prev.r2SecretAccessKey;
      if (r2Changed) await dataRefreshRef.current?.();
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
    tavilyApiKey,
    r2AccountId,
    r2Bucket,
    r2Prefix,
    r2AccessKeyId,
    r2SecretAccessKey,
    accent,
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
      r2AccountId,
      r2Bucket,
      r2Prefix,
      r2AccessKeyId,
      accent,
    });
    if (current === lastPersistedRef.current) return;

    const timer = setTimeout(() => {
      void persistSettings();
    }, SECRETS_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  // Secrets autosave: only debounce credential fields (non-secrets use the effect below).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional split debounce buckets
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
      r2AccountId,
      r2Bucket,
      r2Prefix,
      r2AccessKeyId,
      accent,
    });
    if (current === lastPersistedRef.current) return;

    const timer = setTimeout(() => {
      void persistSettings();
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  // Non-secret settings autosave (secrets debounced separately above).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional split debounce buckets
  }, [
    autoSend,
    globalFnHotkey,
    openToComposeOnLaunch,
    cleanupEnabled,
    cleanupPrompt,
    transcriptDictionary,
    r2AccountId,
    r2Bucket,
    r2Prefix,
    r2AccessKeyId,
    accent,
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
    setTemplateContentDraft("");
    setTemplateIsDefaultDraft(false);
  };

  const openTemplateModal = (template: NoteTemplateConfig) => {
    setEditingTemplateId(template.id);
    setTemplateTitleDraft(template.title);
    setTemplateContentDraft(template.content);
    setTemplateIsDefaultDraft(template.id === defaultNoteTemplateId);
    setTemplatesModalOpen(true);
  };

  const saveTemplate = async () => {
    if (!editingTemplateId) return;
    const nextTitle = templateTitleDraft.trim();
    if (!nextTitle) return;
    const nextTemplates = noteTemplates.map((template) =>
      template.id === editingTemplateId
        ? {
            ...template,
            title: nextTitle,
            content: templateContentDraft,
          }
        : template,
    );
    const normalized = normalizeNoteTemplates(nextTemplates);
    const nextDefaultId = normalizeDefaultNoteTemplateId(
      templateIsDefaultDraft ? editingTemplateId : defaultNoteTemplateId,
      normalized,
    );
    setNoteTemplates(normalized);
    setDefaultNoteTemplateId(nextDefaultId);
    await window.harness.settings.set({
      notes: { templates: normalized, defaultTemplateId: nextDefaultId },
    });
    window.dispatchEvent(new CustomEvent("notes:templatesUpdated", { detail: normalized }));
    closeTemplatesModal();
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
            <SettingsGroup
              title="Theme"
              description="One accent color. Surfaces stay dark; muted and primary accents are derived from it."
            >
              <AccentColorField value={accent} onChange={setAccent} />
            </SettingsGroup>

            <SettingsGroup
              title="Sync"
              description="Show a QR that pairs another device with your API keys and R2 backup settings."
            >
              <SettingsActions>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setSyncQrOpen(true)}
                >
                  Show sync QR
                </button>
              </SettingsActions>
              <SettingsHint>
                Scan on iPhone to apply synced credentials. Configure the R2 bucket under Data → Backup
                if pairing fails.
              </SettingsHint>
            </SettingsGroup>

            <SettingsGroup
              title="Behavior"
              description="How Harness starts, opens notes, and handles dictation."
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
              <SettingsSwitch
                id="openNoteInStickyWindowToggle"
                testId="settings-open-note-in-window"
                label="Open new notes in a window"
                checked={openNoteInStickyWindow}
                onChange={(e) => onOpenNoteInStickyWindowChange?.(e.target.checked)}
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
          </SettingsTabPanel>}

          {activeTab === "notes" && <SettingsTabPanel id="notes">
            <SettingsGroup
              title="Editor templates"
              description="Edit note templates. The default is applied when you create a new note; non-blank templates appear in the picker on a fresh note."
            >
              <div className="settings-entry-list">
                {noteTemplates.map((template) => (
                  <SettingsEntryRow
                    key={template.id}
                    title={template.title}
                    badge={template.id === defaultNoteTemplateId ? "Default" : undefined}
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
                  Cleanup needs an OpenAI API key in Data. On-device transcription still works without one.
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
                  disabled={!templateTitleDraft.trim()}
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
              <label className="app-modal-check">
                <input
                  type="checkbox"
                  className="app-modal-check__input"
                  checked={templateIsDefaultDraft}
                  disabled={templateIsDefaultDraft && editingTemplateId === defaultNoteTemplateId}
                  onChange={(e) => setTemplateIsDefaultDraft(e.target.checked)}
                  data-testid="settings-notes-template-default"
                />
                <span className="app-modal-check__text">Default for new notes</span>
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

          {activeTab === "data" && (
            <DataSettingsTab
              platform={platform}
              apiKey={apiKey}
              setApiKey={setApiKey}
              tavilyApiKey={tavilyApiKey}
              setTavilyApiKey={setTavilyApiKey}
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
              onSyncComplete={onSyncComplete}
              onImportComplete={onImportComplete}
              onRegisterRefresh={registerDataRefresh}
            />
          )}

          <SyncQrModal
            open={syncQrOpen}
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
