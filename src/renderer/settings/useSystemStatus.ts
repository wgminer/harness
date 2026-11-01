import { useCallback, useEffect, useState } from "react";
import type { ChatProviderId } from "../../shared/chatProviders";
import type { GmailStatus } from "../../shared/desktopAPI";
import type { SyncStatus } from "../../shared/sync";
import type {
  TranscriptionEngineId,
  TranscriptionEngineStatus,
} from "../../shared/transcriptionEngines";
import { setCachedAccessibilityTrusted } from "./settingsSessionCache";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ACCESSIBILITY_RECHECK_MS = 1200;

type MicPermission = "granted" | "denied" | "undetermined" | "unsupported";

export interface UsageStats {
  conversations: number | null;
  conversationsThisWeek: number | null;
  wordsDictated: number | null;
  recordings: number | null;
  audioMs: number | null;
  notes: number | null;
  openTasks: number | null;
  images: number | null;
}

export interface SystemStatus {
  keys: { openai: boolean; tavily: boolean; google: boolean; chatReady: boolean; chatProvider: ChatProviderId } | null;
  gmail: GmailStatus | null;
  microphone: MicPermission | null;
  accessibilityTrusted: boolean | null;
  engine: TranscriptionEngineStatus["state"] | null;
  sync: SyncStatus | null;
  memoryCount: number | null;
  usage: UsageStats;
}

const EMPTY_USAGE: UsageStats = {
  conversations: null,
  conversationsThisWeek: null,
  wordsDictated: null,
  recordings: null,
  audioMs: null,
  notes: null,
  openTasks: null,
  images: null,
};

const EMPTY_STATUS: SystemStatus = {
  keys: null,
  gmail: null,
  microphone: null,
  accessibilityTrusted: null,
  engine: null,
  sync: null,
  memoryCount: null,
  usage: EMPTY_USAGE,
};

/** Read-only snapshot of what Harness depends on, plus usage counts, for the Status tab. */
export function useSystemStatus({ engine, isMac }: { engine: TranscriptionEngineId; isMac: boolean }) {
  const [status, setStatus] = useState<SystemStatus>(EMPTY_STATUS);

  const patch = useCallback((partial: Partial<SystemStatus>) => {
    setStatus((prev) => ({ ...prev, ...partial }));
  }, []);
  const patchUsage = useCallback((partial: Partial<UsageStats>) => {
    setStatus((prev) => ({ ...prev, usage: { ...prev.usage, ...partial } }));
  }, []);

  const refreshMicrophone = useCallback(async () => {
    try {
      patch({ microphone: await window.harness.recording.microphonePermissionStatus() });
    } catch {
      patch({ microphone: null });
    }
  }, [patch]);

  const refreshAccessibility = useCallback(async () => {
    if (!isMac) return;
    try {
      const trusted = await window.harness.system.macosAccessibilityTrusted();
      setCachedAccessibilityTrusted(trusted);
      patch({ accessibilityTrusted: trusted });
    } catch {
      patch({ accessibilityTrusted: null });
    }
  }, [isMac, patch]);

  useEffect(() => {
    let cancelled = false;
    const api = window.harness;
    const settle = <T,>(promise: Promise<T>, apply: (value: T) => void) => {
      promise.then((value) => {
        if (!cancelled) apply(value);
      }).catch(() => {});
    };

    settle(api.credentials.getStatus(), (s) =>
      patch({
        keys: {
          openai: s.hasOpenAIApiKey,
          tavily: s.hasTavilyApiKey,
          google: s.hasGoogleApiKey,
          chatReady: s.chatModelReady,
          chatProvider: s.chatProvider,
        },
      }),
    );
    settle(api.gmail.getStatus(), (gmail) => patch({ gmail }));
    settle(api.recording.microphonePermissionStatus(), (microphone) => patch({ microphone }));
    if (isMac) {
      settle(api.system.macosAccessibilityTrusted(), (accessibilityTrusted) => patch({ accessibilityTrusted }));
    }
    if (engine === "apple") {
      patch({ engine: "ready" });
    } else {
      settle(api.recording.transcriptionEngineStatus(engine), (s) => patch({ engine: s.state }));
    }
    settle(api.memory.getDataStatus(), (data) => {
      patch({ sync: data.sync });
      patchUsage({ conversations: data.conversationsCount });
    });
    settle(api.memory.getUserMemory(), (memory) => patch({ memoryCount: Object.keys(memory).length }));
    settle(api.memory.listConversations(), (list) => {
      const since = Date.now() - WEEK_MS;
      patchUsage({ conversationsThisWeek: list.filter((c) => c.createdAt >= since).length });
    });
    settle(api.recording.wordsDictated(), (wordsDictated) => patchUsage({ wordsDictated }));
    settle(api.recording.archiveStats(), (s) => patchUsage({ recordings: s.fileCount, audioMs: s.durationMs }));
    settle(api.notes.list(), (notes) => patchUsage({ notes: notes.length }));
    settle(api.tasks.list(), (payload) =>
      patchUsage({
        openTasks: payload.tasks.filter((t) => t.status === "pending" || t.status === "in_progress").length,
      }),
    );
    settle(api.images.list(), (images) => patchUsage({ images: images.length }));

    const unsubSync = api.sync.onChanged(() => {
      settle(api.sync.getStatus(), (sync) => patch({ sync }));
    });
    return () => {
      cancelled = true;
      unsubSync();
    };
  }, [engine, isMac, patch, patchUsage]);

  const allowMicrophone = useCallback(async () => {
    const granted = await window.harness.recording.requestMicrophoneAccess().catch(() => false);
    if (!granted) void window.harness.system.openMicrophoneSettings();
    await refreshMicrophone();
  }, [refreshMicrophone]);

  const allowAccessibility = useCallback(() => {
    void window.harness.system.requestAccessibilityPrompt();
    void window.harness.system.openAccessibilitySettings();
    setTimeout(() => void refreshAccessibility(), ACCESSIBILITY_RECHECK_MS);
  }, [refreshAccessibility]);

  return { status, allowMicrophone, allowAccessibility };
}
