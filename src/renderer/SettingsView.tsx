import { useState, useEffect, useMemo, useRef, useCallback, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Plus, Settings2 as SettingsIcon, Square, SquareCheck } from "lucide-react";
import { SETTINGS_PAGE_TITLE, settingsSection } from "../shared/settingsPage";
import { DEFAULT_SETTINGS, DEFAULT_LAYOUT } from "../shared/types";
import type { Settings, TranscriptDictionaryEntry, WideView } from "../shared/types";
import { DEFAULT_ACCENT, applyAccent, normalizeAccentHex } from "../shared/accent";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
  DEFAULT_NOTE_TEMPLATES,
  NOTE_TEMPLATE_CURSOR_TOKEN,
  NOTE_TEMPLATE_TODAY_TOKEN,
  isBuiltInNoteTemplateId,
  normalizeDefaultNoteTemplateId,
  normalizeNoteTemplates,
  type NoteTemplateConfig,
} from "../shared/writing";
import type { GlobalRecordingStatus } from "../shared/desktopAPI";
import { Modal } from "./Modal";
import { SyncQrModal } from "./SyncQrModal";
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
import {
  getCachedAccessibilityTrusted,
  getCachedSecrets,
  getCachedSettings,
  loadSettingsForSystemPage,
  nonSecretHydrationFromSettings,
  setCachedAccessibilityTrusted,
  setCachedHasOpenAIApiKey,
  setCachedSecrets,
  setCachedSettings,
  shouldLoadSettingsSecrets,
  type CachedSettingsSecrets,
} from "./settings/settingsSessionCache";

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

const SAVE_DEBOUNCE_MS = 500;
const SECRETS_SAVE_DEBOUNCE_MS = 150;
const SAVED_TOAST_VISIBLE_MS = 3000;

type PersistedFormState = {
  apiKey: string;
  tavilyApiKey: string;
  r2SecretAccessKey: string;
  autoSend: boolean;
  globalFnHotkey: boolean;
  bringToFrontOnBackgroundDictation: boolean;
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
  // Avoid flashing action buttons while macOS permission checks are still in flight.
  if (accessibilityTrusted === null || globalRecordingStatus == null) {
    return null;
  }

  const needsAccessibility =
    accessibilityTrusted !== true ||
    globalRecordingStatus.monitorHealth === "accessibility_denied";
  const mic = globalRecordingStatus.microphonePermission;
  const needsMicrophone = mic !== "granted" && mic !== "unsupported";
  if (!needsAccessibility && !needsMicrophone) return null;

  return (
    <div className="settings-fn-controls">
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
                void window.harness.system.macosAccessibilityTrusted().then((trusted) => {
                  setCachedAccessibilityTrusted(trusted);
                  setAccessibilityTrusted(trusted);
                });
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
  openAIConfigured = false,
}: SettingsViewProps) {
  const initialCached = getCachedSettings();
  const initialNonSecret = initialCached
    ? nonSecretHydrationFromSettings(initialCached)
    : null;
  const initialSecrets = getCachedSecrets();

  const [apiKey, setApiKey] = useState(initialSecrets?.openaiApiKey ?? "");
  const [switchAnimationsReady, setSwitchAnimationsReady] = useState(false);

  const [cleanupEnabled, setCleanupEnabled] = useState(
    initialNonSecret?.cleanupEnabled ?? D.transcription?.cleanup?.enabled ?? false,
  );
  const [cleanupPrompt, setCleanupPrompt] = useState(
    initialNonSecret?.cleanupPrompt ?? D.transcription?.cleanup?.prompt ?? "",
  );
  const [cleanupPromptDraft, setCleanupPromptDraft] = useState(
    initialNonSecret?.cleanupPrompt ?? D.transcription?.cleanup?.prompt ?? "",
  );
  const [transcriptDictionary, setTranscriptDictionary] = useState<TranscriptDictionaryEntry[]>(
    initialNonSecret?.transcriptDictionary ?? D.transcription?.dictionary ?? [],
  );
  const [dictionaryModalOpen, setDictionaryModalOpen] = useState(false);
  const [editingDictionaryFrom, setEditingDictionaryFrom] = useState<string | null>(null);
  const [dictionaryFromDraft, setDictionaryFromDraft] = useState("");
  const [dictionaryToDraft, setDictionaryToDraft] = useState("");
  const [cleanupPromptModalOpen, setCleanupPromptModalOpen] = useState(false);
  const [noteTemplates, setNoteTemplates] = useState<NoteTemplateConfig[]>(
    initialNonSecret?.noteTemplates ?? DEFAULT_NOTE_TEMPLATES.map((t) => ({ ...t })),
  );
  const [defaultNoteTemplateId, setDefaultNoteTemplateId] = useState(
    initialNonSecret?.defaultNoteTemplateId ?? DEFAULT_NOTE_TEMPLATE_ID,
  );
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateTitleDraft, setTemplateTitleDraft] = useState("");
  const [templateContentDraft, setTemplateContentDraft] = useState("");
  const [templateIsDefaultDraft, setTemplateIsDefaultDraft] = useState(false);

  const [autoSend, setAutoSend] = useState(initialNonSecret?.autoSend ?? true);
  const [globalFnHotkey, setGlobalFnHotkey] = useState(
    initialNonSecret?.globalFnHotkey ?? D.recording!.globalFnHotkey,
  );
  const [bringToFrontOnBackgroundDictation, setBringToFrontOnBackgroundDictation] = useState(
    initialNonSecret?.bringToFrontOnBackgroundDictation ??
      D.recording!.bringToFrontOnBackgroundDictation,
  );
  const [openToComposeOnLaunch, setOpenToComposeOnLaunch] = useState(
    initialNonSecret?.openToComposeOnLaunch ?? D.chat!.openToComposeOnLaunch,
  );
  const [tavilyApiKey, setTavilyApiKey] = useState(initialSecrets?.tavilyApiKey ?? "");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [r2AccountId, setR2AccountId] = useState(initialNonSecret?.r2AccountId ?? D.sync!.accountId);
  const [r2Bucket, setR2Bucket] = useState(initialNonSecret?.r2Bucket ?? D.sync!.bucket);
  const [r2Prefix, setR2Prefix] = useState(initialNonSecret?.r2Prefix ?? D.sync!.prefix);
  const [r2AccessKeyId, setR2AccessKeyId] = useState(
    initialNonSecret?.r2AccessKeyId ?? D.sync!.accessKeyId,
  );
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState(
    initialSecrets?.r2SecretAccessKey ?? "",
  );
  const [accent, setAccent] = useState(initialNonSecret?.accent ?? D.appearance?.accent ?? DEFAULT_ACCENT);
  const [wideView, setWideView] = useState<WideView>(DEFAULT_LAYOUT.wideView);
  const [secretsLoaded, setSecretsLoaded] = useState(initialSecrets != null);
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
  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(() =>
    isMac ? getCachedAccessibilityTrusted() : null,
  );
  const [globalRecordingStatus, setGlobalRecordingStatus] = useState<GlobalRecordingStatus | null>(
    null,
  );
  const settingsHydratedRef = useRef(!!initialCached);
  const secretsLoadedRef = useRef(initialSecrets != null);
  const skipAutosaveRef = useRef(false);
  const lastPersistedRef = useRef(
    initialNonSecret
      ? serializeFormState({
          apiKey: initialSecrets?.openaiApiKey ?? "",
          tavilyApiKey: initialSecrets?.tavilyApiKey ?? "",
          r2SecretAccessKey: initialSecrets?.r2SecretAccessKey ?? "",
          autoSend: initialNonSecret.autoSend,
          globalFnHotkey: initialNonSecret.globalFnHotkey,
          bringToFrontOnBackgroundDictation: initialNonSecret.bringToFrontOnBackgroundDictation,
          openToComposeOnLaunch: initialNonSecret.openToComposeOnLaunch,
          cleanupEnabled: initialNonSecret.cleanupEnabled,
          cleanupPrompt: initialNonSecret.cleanupPrompt,
          transcriptDictionary: initialNonSecret.transcriptDictionary,
          r2AccountId: initialNonSecret.r2AccountId,
          r2Bucket: initialNonSecret.r2Bucket,
          r2Prefix: initialNonSecret.r2Prefix,
          r2AccessKeyId: initialNonSecret.r2AccessKeyId,
          accent: initialNonSecret.accent,
        })
      : "",
  );
  const hideToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistSettingsRef = useRef<() => Promise<boolean>>(async () => true);
  const flushSettingsOnUnmountRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Record<SettingsTabId, HTMLButtonElement | null>>({
    general: null,
    notes: null,
    voice: null,
    data: null,
  });
  const [activeTab, setActiveTab] = useState<SettingsTabId>(normalizeSettingsTab(initialTab));
  const [syncQrOpen, setSyncQrOpen] = useState(false);

  const applySecretsToForm = useCallback((secrets: CachedSettingsSecrets) => {
    skipAutosaveRef.current = true;
    setApiKey(secrets.openaiApiKey);
    setTavilyApiKey(secrets.tavilyApiKey);
    setR2SecretAccessKey(secrets.r2SecretAccessKey);
    setCachedHasOpenAIApiKey(secrets.openaiApiKey.trim().length > 0);
    const prev = JSON.parse(lastPersistedRef.current || "{}") as Partial<PersistedFormState>;
    lastPersistedRef.current = serializeFormState({
      apiKey: secrets.openaiApiKey,
      tavilyApiKey: secrets.tavilyApiKey,
      r2SecretAccessKey: secrets.r2SecretAccessKey,
      autoSend: prev.autoSend ?? autoSend,
      globalFnHotkey: prev.globalFnHotkey ?? globalFnHotkey,
      bringToFrontOnBackgroundDictation:
        prev.bringToFrontOnBackgroundDictation ?? bringToFrontOnBackgroundDictation,
      openToComposeOnLaunch: prev.openToComposeOnLaunch ?? openToComposeOnLaunch,
      cleanupEnabled: prev.cleanupEnabled ?? cleanupEnabled,
      cleanupPrompt: prev.cleanupPrompt ?? cleanupPrompt,
      transcriptDictionary: prev.transcriptDictionary ?? transcriptDictionary,
      r2AccountId: prev.r2AccountId ?? r2AccountId,
      r2Bucket: prev.r2Bucket ?? r2Bucket,
      r2Prefix: prev.r2Prefix ?? r2Prefix,
      r2AccessKeyId: prev.r2AccessKeyId ?? r2AccessKeyId,
      accent: prev.accent ?? accent,
    });
    secretsLoadedRef.current = true;
    setSecretsLoaded(true);
  }, [
    accent,
    autoSend,
    cleanupEnabled,
    cleanupPrompt,
    globalFnHotkey,
    bringToFrontOnBackgroundDictation,
    openToComposeOnLaunch,
    r2AccessKeyId,
    r2AccountId,
    r2Bucket,
    r2Prefix,
    transcriptDictionary,
  ]);

  useEffect(() => {
    setActiveTab(normalizeSettingsTab(initialTab));
  }, [initialTab]);

  useEffect(() => {
    let cancelled = false;
    void window.harness.customization.getLayoutOptions().then((layout) => {
      if (!cancelled && (layout.wideView === "centered" || layout.wideView === "scaled")) {
        setWideView(layout.wideView);
      }
    });
    const unsub = window.harness.customization.onUpdated((p) => {
      if (p.type !== "layout") return;
      void window.harness.customization.getLayoutOptions().then((layout) => {
        if (!cancelled && (layout.wideView === "centered" || layout.wideView === "scaled")) {
          setWideView(layout.wideView);
        }
      });
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const handleWideViewChange = useCallback((next: WideView) => {
    setWideView(next);
    void window.harness.customization.setLayout({ wideView: next });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const enableSwitchAnimations = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setSwitchAnimationsReady(true);
        });
      });
    };

    const applyNonSecrets = (S: Settings, secrets: CachedSettingsSecrets | null) => {
      skipAutosaveRef.current = true;
      const nonSecret = nonSecretHydrationFromSettings(S);
      const hydrated: PersistedFormState = {
        apiKey: secrets?.openaiApiKey ?? "",
        tavilyApiKey: secrets?.tavilyApiKey ?? "",
        r2SecretAccessKey: secrets?.r2SecretAccessKey ?? "",
        autoSend: nonSecret.autoSend,
        globalFnHotkey: nonSecret.globalFnHotkey,
        bringToFrontOnBackgroundDictation: nonSecret.bringToFrontOnBackgroundDictation,
        openToComposeOnLaunch: nonSecret.openToComposeOnLaunch,
        cleanupEnabled: nonSecret.cleanupEnabled,
        cleanupPrompt: nonSecret.cleanupPrompt,
        transcriptDictionary: nonSecret.transcriptDictionary,
        r2AccountId: nonSecret.r2AccountId,
        r2Bucket: nonSecret.r2Bucket,
        r2Prefix: nonSecret.r2Prefix,
        r2AccessKeyId: nonSecret.r2AccessKeyId,
        accent: nonSecret.accent,
      };
      if (secrets) {
        setApiKey(hydrated.apiKey);
        setTavilyApiKey(hydrated.tavilyApiKey);
        setR2SecretAccessKey(hydrated.r2SecretAccessKey);
        secretsLoadedRef.current = true;
        setSecretsLoaded(true);
      }
      setAutoSend(hydrated.autoSend);
      setGlobalFnHotkey(hydrated.globalFnHotkey);
      setBringToFrontOnBackgroundDictation(hydrated.bringToFrontOnBackgroundDictation);
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
      setNoteTemplates(nonSecret.noteTemplates);
      setDefaultNoteTemplateId(nonSecret.defaultNoteTemplateId);
      lastPersistedRef.current = serializeFormState(hydrated);
    };

    void (async () => {
      try {
        const { settings, fetched } = await loadSettingsForSystemPage({
          getCached: getCachedSettings,
          fetchSettings: () => window.harness.settings.get() as Promise<Settings>,
          setCache: setCachedSettings,
        });
        if (cancelled) return;
        // Warm cache already seeded React state on mount; only apply after a cold fetch.
        if (fetched) {
          applyNonSecrets(settings, getCachedSecrets());
        }
      } finally {
        if (!cancelled) {
          settingsHydratedRef.current = true;
          enableSwitchAnimations();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!shouldLoadSettingsSecrets(activeTab, syncQrOpen, secretsLoadedRef.current)) return;
    let cancelled = false;
    void window.harness.credentials
      .getSecretsForSettings()
      .then((secrets) => {
        if (cancelled) return;
        setCachedSecrets(secrets);
        applySecretsToForm(secrets);
      })
      .catch((err) => {
        console.error("[Settings] secrets load failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, applySecretsToForm, syncQrOpen]);

  useEffect(() => {
    if (!isMac) return;
    let cancelled = false;
    const cached = getCachedAccessibilityTrusted();
    if (cached != null) setAccessibilityTrusted(cached);
    const outer = requestAnimationFrame(() => {
      const inner = requestAnimationFrame(() => {
        void window.harness.system.macosAccessibilityTrusted().then((trusted) => {
          if (cancelled) return;
          setCachedAccessibilityTrusted(trusted);
          setAccessibilityTrusted(trusted);
        });
      });
      // Stash inner id on outer cancellation via closed-over flag only.
      void inner;
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
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
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        void refreshGlobalRecordingStatus();
        timer = setInterval(() => {
          void refreshGlobalRecordingStatus();
        }, 3000);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      if (timer) clearInterval(timer);
    };
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
      bringToFrontOnBackgroundDictation,
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
    // No-op: stay silent. Toast only after a real write (avoids Strict Mode
    // remount / blur / unmount flush flashing "Saved" on an unchanged form).
    if (latest === lastPersistedRef.current) return true;

    const prev = JSON.parse(lastPersistedRef.current || "{}") as Partial<PersistedFormState>;
    const next = JSON.parse(latest) as PersistedFormState;

    if (hideToastRef.current) clearTimeout(hideToastRef.current);
    setSaveStatus("saving");

    try {
      if (next.apiKey !== (prev.apiKey ?? "")) {
        await window.harness.credentials.setOpenAIApiKey(next.apiKey.trim());
        setCachedHasOpenAIApiKey(next.apiKey.trim().length > 0);
      }
      if (next.tavilyApiKey !== (prev.tavilyApiKey ?? "")) {
        await window.harness.credentials.setTavilyApiKey(next.tavilyApiKey.trim());
      }
      if (next.r2SecretAccessKey !== (prev.r2SecretAccessKey ?? "")) {
        await window.harness.credentials.setR2SecretAccessKey(next.r2SecretAccessKey.trim());
      }
      await window.harness.settings.set({
        recording: {
          autoSend: next.autoSend,
          globalFnHotkey: next.globalFnHotkey,
          bringToFrontOnBackgroundDictation: next.bringToFrontOnBackgroundDictation,
        },
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
      try {
        const refreshed = (await window.harness.settings.get()) as Settings;
        setCachedSettings(refreshed);
      } catch {
        // Keep prior cache if refresh fails; form state is still authoritative.
      }
      if (secretsLoadedRef.current) {
        setCachedSecrets({
          openaiApiKey: next.apiKey,
          tavilyApiKey: next.tavilyApiKey,
          r2SecretAccessKey: next.r2SecretAccessKey,
        });
      }
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
    bringToFrontOnBackgroundDictation,
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
      bringToFrontOnBackgroundDictation,
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

    // Arm unmount flush only when there is a pending dirty write.
    flushSettingsOnUnmountRef.current = true;
    const timer = setTimeout(() => {
      void persistSettings();
    }, SECRETS_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  // Secrets autosave: only debounce credential fields (non-secrets use the effect below).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional split debounce buckets
  }, [apiKey, tavilyApiKey, r2SecretAccessKey, persistSettings]);

  useEffect(() => {
    if (!settingsHydratedRef.current) return;
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
      bringToFrontOnBackgroundDictation,
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

    flushSettingsOnUnmountRef.current = true;
    const timer = setTimeout(() => {
      void persistSettings();
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  // Non-secret settings autosave (secrets debounced separately above).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional split debounce buckets
  }, [
    autoSend,
    globalFnHotkey,
    bringToFrontOnBackgroundDictation,
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

  const openCreateTemplateModal = () => {
    setEditingTemplateId(null);
    setTemplateTitleDraft("");
    setTemplateContentDraft("");
    setTemplateIsDefaultDraft(false);
    setTemplatesModalOpen(true);
  };

  const openTemplateModal = (template: NoteTemplateConfig) => {
    setEditingTemplateId(template.id);
    setTemplateTitleDraft(template.title);
    setTemplateContentDraft(template.content);
    setTemplateIsDefaultDraft(template.id === defaultNoteTemplateId);
    setTemplatesModalOpen(true);
  };

  const persistTemplates = async (
    nextTemplates: NoteTemplateConfig[],
    nextDefaultId: string,
  ) => {
    const normalized = normalizeNoteTemplates(nextTemplates);
    const resolvedDefaultId = normalizeDefaultNoteTemplateId(nextDefaultId, normalized);
    setNoteTemplates(normalized);
    setDefaultNoteTemplateId(resolvedDefaultId);
    await window.harness.settings.set({
      notes: { templates: normalized, defaultTemplateId: resolvedDefaultId },
    });
    window.dispatchEvent(new CustomEvent("notes:templatesUpdated", { detail: normalized }));
  };

  const saveTemplate = async () => {
    const nextTitle = templateTitleDraft.trim();
    if (!nextTitle) return;

    if (editingTemplateId) {
      const nextTemplates = noteTemplates.map((template) =>
        template.id === editingTemplateId
          ? {
              ...template,
              title: nextTitle,
              content: templateContentDraft,
            }
          : template,
      );
      const nextDefaultId = templateIsDefaultDraft ? editingTemplateId : defaultNoteTemplateId;
      await persistTemplates(nextTemplates, nextDefaultId);
    } else {
      const newId = crypto.randomUUID();
      const nextTemplates = [
        ...noteTemplates,
        { id: newId, title: nextTitle, content: templateContentDraft },
      ];
      const nextDefaultId = templateIsDefaultDraft ? newId : defaultNoteTemplateId;
      await persistTemplates(nextTemplates, nextDefaultId);
    }
    closeTemplatesModal();
  };

  const deleteTemplate = async () => {
    if (!editingTemplateId || isBuiltInNoteTemplateId(editingTemplateId)) return;
    const nextTemplates = noteTemplates.filter((template) => template.id !== editingTemplateId);
    const nextDefaultId =
      defaultNoteTemplateId === editingTemplateId
        ? DEFAULT_NOTE_TEMPLATE_ID
        : defaultNoteTemplateId;
    await persistTemplates(nextTemplates, nextDefaultId);
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
      <div ref={scrollRef} className="workspace-scroll settings-scroll">
        <WorkspaceHeader
          title={SETTINGS_PAGE_TITLE}
          icon={<SettingsIcon size={24} />}
          actions={
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
          }
        />
        <SettingsSwitchProvider animationsReady={switchAnimationsReady}>
        <div className="workspace-content settings-content">
          {activeTab === "general" && <SettingsTabPanel id="general">
            <SettingsGroup title="Theme" description="Accent only — chrome stays dark.">
              <AccentColorField value={accent} onChange={setAccent} />
            </SettingsGroup>

            <SettingsGroup
              title="Large window"
              description="Centered readable column, or edge-to-edge."
            >
              <div
                className="settings-segmented"
                role="radiogroup"
                aria-label="Large window layout"
              >
                <button
                  type="button"
                  role="radio"
                  className={`settings-segment${wideView === "scaled" ? " settings-segment--active" : ""}`}
                  aria-checked={wideView === "scaled"}
                  data-testid="settings-wide-view-scaled"
                  onClick={() => handleWideViewChange("scaled")}
                >
                  Scaled
                </button>
                <button
                  type="button"
                  role="radio"
                  className={`settings-segment${wideView === "centered" ? " settings-segment--active" : ""}`}
                  aria-checked={wideView === "centered"}
                  data-testid="settings-wide-view-centered"
                  onClick={() => handleWideViewChange("centered")}
                >
                  Centered
                </button>
              </div>
            </SettingsGroup>

            <SettingsGroup title="Sync">
              <SettingsActions>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSyncQrOpen(true)}
                >
                  Show Sync QR
                </button>
              </SettingsActions>
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
            <SettingsGroup title="Editor templates">
              <div className="settings-template-grid">
                {noteTemplates.map((template) => {
                  const isDefault = template.id === defaultNoteTemplateId;
                  const preview = template.content.replace(/\s+$/, "");
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className="settings-template-card"
                      onClick={() => openTemplateModal(template)}
                      aria-label={`Edit ${template.title} template`}
                      data-testid={`settings-notes-template-card-${template.id}`}
                    >
                      <div className="settings-template-card__header">
                        <span className="settings-template-card__title">{template.title}</span>
                        {isDefault ? (
                          <span className="settings-template-card__badge">Default</span>
                        ) : null}
                      </div>
                      <div className="settings-template-card__preview" aria-hidden>
                        {preview.length > 0 ? preview : "Empty"}
                      </div>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="settings-template-card settings-template-card--add"
                  onClick={openCreateTemplateModal}
                  aria-label="Add template"
                  data-testid="settings-notes-template-add"
                >
                  <Plus size={24} strokeWidth={2} aria-hidden />
                  <span className="settings-template-card__add-label">Add template</span>
                </button>
              </div>
            </SettingsGroup>
          </SettingsTabPanel>}

          {activeTab === "voice" && <SettingsTabPanel id="voice">
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

          <Modal
            open={templatesModalOpen}
            onClose={closeTemplatesModal}
            title={editingTemplateId ? "Edit notes template" : "Add notes template"}
            data-testid="settings-notes-template-modal"
            footerClassName={
              editingTemplateId && !isBuiltInNoteTemplateId(editingTemplateId)
                ? "app-modal-footer--spread"
                : undefined
            }
            footer={
              <>
                {editingTemplateId && !isBuiltInNoteTemplateId(editingTemplateId) ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => void deleteTemplate()}
                    data-testid="settings-notes-template-delete"
                  >
                    Delete
                  </button>
                ) : null}
                <div className="app-modal-footer-actions">
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
                </div>
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
                <span className="app-modal-field__label">Template body</span>
                <textarea
                  value={templateContentDraft}
                  onChange={(e) => setTemplateContentDraft(e.target.value)}
                  className="app-modal-input app-modal-input--multiline settings-template-content-input"
                  rows={10}
                />
                <p className="app-modal-field__hint">
                  Use <code>{NOTE_TEMPLATE_TODAY_TOKEN}</code> for today&apos;s date and{" "}
                  <code>{NOTE_TEMPLATE_CURSOR_TOKEN}</code> to place the cursor when the note opens.
                </p>
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
                <span className="app-modal-check__icon" aria-hidden>
                  {templateIsDefaultDraft ? (
                    <SquareCheck size={18} strokeWidth={2} />
                  ) : (
                    <Square size={18} strokeWidth={2} />
                  )}
                </span>
                <span className="app-modal-check__text">Default for new notes</span>
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
