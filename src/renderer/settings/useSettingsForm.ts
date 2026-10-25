import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { DEFAULT_SETTINGS } from "../../shared/types";
import type { Settings } from "../../shared/types";
import { DEFAULT_ACCENT, applyAccent, normalizeAccentHex } from "../../shared/accent";
import { applyAppearanceTheme } from "../../shared/timeOfDayBackground";
import { applyCropCursor } from "../ui/cursors/whipCursor";
import {
  DEFAULT_APPEARANCE_THEME,
  normalizeAppearanceTheme,
  type AppearanceTheme,
} from "../../shared/types";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
  DEFAULT_NOTE_TEMPLATES,
  type NoteTemplateConfig,
} from "../../shared/writing";
import type { GlobalRecordingStatus } from "../../shared/desktopAPI";
import {
  DEFAULT_TRANSCRIPTION_ENGINE,
  type TranscriptionEngineId,
} from "../../shared/transcriptionEngines";
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
  type CachedSettingsSecrets,
} from "./settingsSessionCache";

const SAVE_DEBOUNCE_MS = 500;
const SECRETS_SAVE_DEBOUNCE_MS = 150;
const SAVED_TOAST_VISIBLE_MS = 3000;

type PersistedFormState = {
  apiKey: string;
  tavilyApiKey: string;
  googleApiKey: string;
  r2SecretAccessKey: string;
  autoSend: boolean;
  globalFnHotkey: boolean;
  bringToFrontOnBackgroundDictation: boolean;
  openToComposeOnLaunch: boolean;
  selectionImageLookup: boolean;
  cleanupEnabled: boolean;
  cleanupPrompt: string;
  transcriptGlossary: string[];
  transcriptionEngine: TranscriptionEngineId;
  r2AccountId: string;
  r2Bucket: string;
  r2Prefix: string;
  r2AccessKeyId: string;
  accent: string;
  appearanceTheme: AppearanceTheme;
  cropCursor: boolean;
  weatherZip: string;
};

function serializeFormState(state: PersistedFormState): string {
  return JSON.stringify(state);
}

const D = DEFAULT_SETTINGS;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseSettingsFormOptions {
  /** Fires after debounced settings autosave completes. */
  onSettingsChanged?: () => void;
  /** Load secrets from the credential store (only when a field that shows them is on screen). */
  wantsSecrets: boolean;
  /** Poll Fn hotkey / microphone status while its controls are visible. */
  pollRecordingStatus: boolean;
}

/** Form state, hydration and debounced autosave for the System page. */
export function useSettingsForm({
  onSettingsChanged,
  wantsSecrets,
  pollRecordingStatus,
}: UseSettingsFormOptions) {
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
  const [transcriptGlossary, setTranscriptGlossary] = useState<string[]>(
    initialNonSecret?.transcriptGlossary ?? D.transcription?.glossary ?? [],
  );
  const [transcriptionEngine, setTranscriptionEngine] = useState<TranscriptionEngineId>(
    initialNonSecret?.transcriptionEngine ?? DEFAULT_TRANSCRIPTION_ENGINE,
  );
  const [noteTemplates, setNoteTemplates] = useState<NoteTemplateConfig[]>(
    initialNonSecret?.noteTemplates ?? DEFAULT_NOTE_TEMPLATES.map((t) => ({ ...t })),
  );
  const [defaultNoteTemplateId, setDefaultNoteTemplateId] = useState(
    initialNonSecret?.defaultNoteTemplateId ?? DEFAULT_NOTE_TEMPLATE_ID,
  );

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
  const [selectionImageLookup, setSelectionImageLookup] = useState(
    initialNonSecret?.selectionImageLookup ?? D.chat!.selectionImageLookup,
  );
  const [tavilyApiKey, setTavilyApiKey] = useState(initialSecrets?.tavilyApiKey ?? "");
  const [googleApiKey, setGoogleApiKey] = useState(initialSecrets?.googleApiKey ?? "");
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
  const [appearanceTheme, setAppearanceTheme] = useState<AppearanceTheme>(
    initialNonSecret?.appearanceTheme ?? D.appearance?.theme ?? DEFAULT_APPEARANCE_THEME,
  );
  const [cropCursor, setCropCursor] = useState(
    initialNonSecret?.cropCursor ?? D.appearance?.cropCursor ?? false,
  );
  const [weatherZip, setWeatherZip] = useState(
    initialNonSecret?.weatherZip ?? D.weather!.defaultZip,
  );
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

  const getFormSnapshot = useCallback(
    (overrides?: Partial<PersistedFormState>): PersistedFormState => ({
      apiKey,
      tavilyApiKey,
      googleApiKey,
      r2SecretAccessKey,
      autoSend,
      globalFnHotkey,
      bringToFrontOnBackgroundDictation,
      openToComposeOnLaunch,
      selectionImageLookup,
      cleanupEnabled,
      cleanupPrompt,
      transcriptGlossary,
      transcriptionEngine,
      r2AccountId,
      r2Bucket,
      r2Prefix,
      r2AccessKeyId,
      accent,
      appearanceTheme,
      cropCursor,
      weatherZip,
      ...overrides,
    }),
    [
      apiKey,
      tavilyApiKey,
      googleApiKey,
      r2SecretAccessKey,
      autoSend,
      globalFnHotkey,
      bringToFrontOnBackgroundDictation,
      openToComposeOnLaunch,
      selectionImageLookup,
      cleanupEnabled,
      cleanupPrompt,
      transcriptGlossary,
      transcriptionEngine,
      r2AccountId,
      r2Bucket,
      r2Prefix,
      r2AccessKeyId,
      accent,
      appearanceTheme,
      cropCursor,
      weatherZip,
    ],
  );
  const getFormSnapshotRef = useRef(getFormSnapshot);
  getFormSnapshotRef.current = getFormSnapshot;

  const lastPersistedRef = useRef(
    initialNonSecret ? serializeFormState(getFormSnapshot()) : "",
  );
  const hideToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistSettingsRef = useRef<() => Promise<boolean>>(async () => true);
  const flushSettingsOnUnmountRef = useRef(false);
  const applySecretsToForm = useCallback((secrets: CachedSettingsSecrets) => {
    skipAutosaveRef.current = true;
    setApiKey(secrets.openaiApiKey);
    setTavilyApiKey(secrets.tavilyApiKey);
    setGoogleApiKey(secrets.googleApiKey);
    setR2SecretAccessKey(secrets.r2SecretAccessKey);
    setCachedHasOpenAIApiKey(secrets.openaiApiKey.trim().length > 0);
    lastPersistedRef.current = serializeFormState(
      getFormSnapshotRef.current({
        apiKey: secrets.openaiApiKey,
        tavilyApiKey: secrets.tavilyApiKey,
        googleApiKey: secrets.googleApiKey,
        r2SecretAccessKey: secrets.r2SecretAccessKey,
      }),
    );
    secretsLoadedRef.current = true;
    setSecretsLoaded(true);
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
        googleApiKey: secrets?.googleApiKey ?? "",
        r2SecretAccessKey: secrets?.r2SecretAccessKey ?? "",
        autoSend: nonSecret.autoSend,
        globalFnHotkey: nonSecret.globalFnHotkey,
        bringToFrontOnBackgroundDictation: nonSecret.bringToFrontOnBackgroundDictation,
        openToComposeOnLaunch: nonSecret.openToComposeOnLaunch,
        selectionImageLookup: nonSecret.selectionImageLookup,
        cleanupEnabled: nonSecret.cleanupEnabled,
        cleanupPrompt: nonSecret.cleanupPrompt,
        transcriptGlossary: nonSecret.transcriptGlossary,
        transcriptionEngine: nonSecret.transcriptionEngine,
        r2AccountId: nonSecret.r2AccountId,
        r2Bucket: nonSecret.r2Bucket,
        r2Prefix: nonSecret.r2Prefix,
        r2AccessKeyId: nonSecret.r2AccessKeyId,
        accent: nonSecret.accent,
        appearanceTheme: nonSecret.appearanceTheme,
        cropCursor: nonSecret.cropCursor,
        weatherZip: nonSecret.weatherZip,
      };
      if (secrets) {
        setApiKey(hydrated.apiKey);
        setTavilyApiKey(hydrated.tavilyApiKey);
        setGoogleApiKey(hydrated.googleApiKey);
        setR2SecretAccessKey(hydrated.r2SecretAccessKey);
        secretsLoadedRef.current = true;
        setSecretsLoaded(true);
      }
      setAutoSend(hydrated.autoSend);
      setGlobalFnHotkey(hydrated.globalFnHotkey);
      setBringToFrontOnBackgroundDictation(hydrated.bringToFrontOnBackgroundDictation);
      setOpenToComposeOnLaunch(hydrated.openToComposeOnLaunch);
      setSelectionImageLookup(hydrated.selectionImageLookup);
      setCleanupEnabled(hydrated.cleanupEnabled);
      setCleanupPrompt(hydrated.cleanupPrompt);
      setTranscriptGlossary(hydrated.transcriptGlossary);
      setTranscriptionEngine(hydrated.transcriptionEngine);
      setR2AccountId(hydrated.r2AccountId);
      setR2Bucket(hydrated.r2Bucket);
      setR2Prefix(hydrated.r2Prefix);
      setR2AccessKeyId(hydrated.r2AccessKeyId);
      setAccent(hydrated.accent);
      setAppearanceTheme(hydrated.appearanceTheme);
      setCropCursor(hydrated.cropCursor);
      setWeatherZip(hydrated.weatherZip);
      applyAccent(hydrated.accent);
      applyAppearanceTheme(hydrated.appearanceTheme);
      applyCropCursor(hydrated.cropCursor);
      setNoteTemplates(nonSecret.noteTemplates);
      setDefaultNoteTemplateId(nonSecret.defaultNoteTemplateId);
      lastPersistedRef.current = serializeFormState(hydrated);
    };

    void (async () => {
      try {
        const { settings } = await loadSettingsForSystemPage({
          getCached: getCachedSettings,
          fetchSettings: () => window.harness.settings.get() as Promise<Settings>,
          setCache: setCachedSettings,
        });
        if (cancelled) return;
        applyNonSecrets(settings, getCachedSecrets());
      } finally {
        if (!cancelled) {
          settingsHydratedRef.current = true;
          enableSwitchAnimations();
        }
      }
    })();

    const unsubSync = window.harness.sync.onChanged(() => {
      void (async () => {
        try {
          const settings = (await window.harness.settings.get()) as Settings;
          if (cancelled) return;
          setCachedSettings(settings);
          const current = serializeFormState(getFormSnapshotRef.current());
          if (current !== lastPersistedRef.current) return;
          applyNonSecrets(settings, getCachedSecrets());
        } catch {
          // Keep the open form if a background refresh fails.
        }
      })();
    });

    return () => {
      cancelled = true;
      unsubSync();
    };
  }, []);

  useEffect(() => {
    if (!wantsSecrets || secretsLoadedRef.current) return;
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
  }, [applySecretsToForm, wantsSecrets]);

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
    if (!isMac || !pollRecordingStatus || !globalFnHotkey) return;
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
  }, [globalFnHotkey, isMac, pollRecordingStatus, refreshGlobalRecordingStatus]);

  useEffect(() => {
    return () => {
      if (hideToastRef.current) clearTimeout(hideToastRef.current);
    };
  }, []);

  const persistSettings = useCallback(async (): Promise<boolean> => {
    const latestState = getFormSnapshotRef.current();
    const latest = serializeFormState(latestState);
    // No-op: stay silent. Toast only after a real write (avoids Strict Mode
    // remount / blur / unmount flush flashing "Saved" on an unchanged form).
    if (latest === lastPersistedRef.current) return true;

    const prev = JSON.parse(lastPersistedRef.current || "{}") as Partial<PersistedFormState>;
    const next = latestState;

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
      if (next.googleApiKey !== (prev.googleApiKey ?? "")) {
        await window.harness.credentials.setGoogleApiKey(next.googleApiKey.trim());
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
        chat: {
          openToComposeOnLaunch: next.openToComposeOnLaunch,
          selectionImageLookup: next.selectionImageLookup,
        },
        transcription: {
          cleanup: {
            enabled: next.cleanupEnabled,
            prompt: next.cleanupPrompt,
          },
          glossary: next.transcriptGlossary,
          engine: next.transcriptionEngine,
        },
        sync: {
          accountId: next.r2AccountId.trim(),
          bucket: next.r2Bucket.trim(),
          prefix: next.r2Prefix.trim() || D.sync!.prefix,
          accessKeyId: next.r2AccessKeyId.trim(),
        },
        appearance: {
          accent: normalizeAccentHex(next.accent),
          theme: normalizeAppearanceTheme(next.appearanceTheme),
          cropCursor: next.cropCursor,
        },
        weather: { defaultZip: next.weatherZip.trim() },
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
          googleApiKey: next.googleApiKey,
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
  }, [onSettingsChanged]);

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

    const current = serializeFormState(getFormSnapshotRef.current());
    if (current === lastPersistedRef.current) return;

    // Arm unmount flush only when there is a pending dirty write.
    flushSettingsOnUnmountRef.current = true;
    const timer = setTimeout(() => {
      void persistSettings();
    }, SECRETS_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [apiKey, tavilyApiKey, googleApiKey, r2SecretAccessKey, persistSettings]);

  useEffect(() => {
    if (!settingsHydratedRef.current) return;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    const current = serializeFormState(getFormSnapshotRef.current());
    if (current === lastPersistedRef.current) return;

    flushSettingsOnUnmountRef.current = true;
    const timer = setTimeout(() => {
      void persistSettings();
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    autoSend,
    globalFnHotkey,
    bringToFrontOnBackgroundDictation,
    openToComposeOnLaunch,
    selectionImageLookup,
    cleanupEnabled,
    cleanupPrompt,
    transcriptGlossary,
    transcriptionEngine,
    r2AccountId,
    r2Bucket,
    r2Prefix,
    r2AccessKeyId,
    accent,
    appearanceTheme,
    cropCursor,
    weatherZip,
    persistSettings,
  ]);

  const handleTemplatesChange = useCallback(
    async (nextTemplates: NoteTemplateConfig[], nextDefaultId: string) => {
      setNoteTemplates(nextTemplates);
      setDefaultNoteTemplateId(nextDefaultId);
      await window.harness.settings.set({
        notes: { templates: nextTemplates, defaultTemplateId: nextDefaultId },
      });
      window.dispatchEvent(new CustomEvent("notes:templatesUpdated", { detail: nextTemplates }));
    },
    [],
  );

  return {
    apiKey, setApiKey,
    tavilyApiKey, setTavilyApiKey,
    googleApiKey, setGoogleApiKey,
    r2SecretAccessKey, setR2SecretAccessKey,
    r2AccountId, setR2AccountId,
    r2Bucket, setR2Bucket,
    r2Prefix, setR2Prefix,
    r2AccessKeyId, setR2AccessKeyId,
    cleanupEnabled, setCleanupEnabled,
    cleanupPrompt, setCleanupPrompt,
    transcriptGlossary, setTranscriptGlossary,
    transcriptionEngine, setTranscriptionEngine,
    noteTemplates, defaultNoteTemplateId, handleTemplatesChange,
    autoSend, setAutoSend,
    globalFnHotkey, setGlobalFnHotkey,
    bringToFrontOnBackgroundDictation, setBringToFrontOnBackgroundDictation,
    openToComposeOnLaunch, setOpenToComposeOnLaunch,
    selectionImageLookup, setSelectionImageLookup,
    accent, setAccent,
    appearanceTheme, setAppearanceTheme,
    cropCursor, setCropCursor,
    weatherZip, setWeatherZip,
    saveStatus,
    secretsLoaded,
    switchAnimationsReady,
    persistSettings,
    registerDataRefresh,
    platform,
    isMac,
    accessibilityTrusted, setAccessibilityTrusted,
    globalRecordingStatus, refreshGlobalRecordingStatus,
  };
}

export type SettingsForm = ReturnType<typeof useSettingsForm>;
