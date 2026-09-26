import { useCallback, useEffect, useState } from "react";
import type { Settings } from "../../shared/types";
import { collectSetupGaps, shouldShowSetupNotice, type SetupGap } from "../../shared/setupState";
import {
  setCachedAccessibilityTrusted,
  setCachedHasOpenAIApiKey,
  setCachedSettings,
} from "../settings/settingsSessionCache";

/** Setup gaps (API key, sync, accessibility) and the first-run setup notice. */
export function useSetupState({ uiSessionReady }: { uiSessionReady: boolean }) {
  const [setupGaps, setSetupGaps] = useState<SetupGap[]>([]);
  const [setupNoticeOpen, setSetupNoticeOpen] = useState(false);
  const [openAIConfigured, setOpenAIConfigured] = useState(false);
  const [webClient, setWebClient] = useState(false);
  const [setupStateLoaded, setSetupStateLoaded] = useState(false);

  const refreshSetupState = useCallback(async () => {
    const [settings, syncStatus, credentialStatus, platform, webClient] = await Promise.all([
      window.harness.settings.get() as Promise<Settings>,
      window.harness.sync.getStatus(),
      window.harness.credentials.getStatus(),
      window.harness.system.getPlatform(),
      window.harness.env.isHarnessWeb(),
    ]);
    setCachedSettings(settings);
    setCachedHasOpenAIApiKey(credentialStatus.hasOpenAIApiKey);
    let accessibilityTrusted: boolean | null = null;
    if (platform === "darwin") {
      accessibilityTrusted = await window.harness.system.macosAccessibilityTrusted();
      setCachedAccessibilityTrusted(accessibilityTrusted);
    }
    const gaps = collectSetupGaps({
      hasOpenAIApiKey: credentialStatus.hasOpenAIApiKey,
      syncConfigured: syncStatus.configured,
      platform,
      accessibilityTrusted,
    });
    setSetupGaps(gaps);
    setWebClient(webClient);
    setOpenAIConfigured(credentialStatus.hasOpenAIApiKey);
    setSetupStateLoaded(true);
    return gaps;
  }, []);

  useEffect(() => {
    if (!uiSessionReady) return;
    let cancelled = false;
    void (async () => {
      const [gaps, session] = await Promise.all([
        refreshSetupState(),
        window.harness.uiSession.get(),
      ]);
      if (cancelled) return;
      if (shouldShowSetupNotice(gaps, session.setupNoticeDismissed === true)) {
        setSetupNoticeOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uiSessionReady, refreshSetupState]);

  const dismissSetupNotice = useCallback(() => {
    setSetupNoticeOpen(false);
  }, []);

  const saveSetupApiKey = useCallback(
    async (apiKey: string) => {
      await window.harness.credentials.setOpenAIApiKey(apiKey);
      setCachedHasOpenAIApiKey(true);
      await refreshSetupState();
      setSetupNoticeOpen(false);
      void window.harness.uiSession.set({ setupNoticeDismissed: true });
    },
    [refreshSetupState],
  );

  return {
    /** Only a required gap (missing API key) is worth interrupting for. */
    setupNoticeVisible: setupNoticeOpen && setupGaps.some((gap) => gap.severity === "required"),
    /** Optimistic until the first load so chat doesn't flash the "add a key" state. */
    chatModelAvailable: !setupStateLoaded || openAIConfigured || webClient,
    openAIConfigured,
    refreshSetupState,
    dismissSetupNotice,
    saveSetupApiKey,
  };
}
