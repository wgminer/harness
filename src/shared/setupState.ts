import { rigSection } from "./rigPage";

export type SetupGapKind = "openai_api_key" | "sync_r2" | "macos_accessibility" | "parakeet_model";

export interface SetupGap {
  kind: SetupGapKind;
  title: string;
  detail: string;
  /** Settings tab to open when the user chooses "Set up". */
  settingsTab: "general" | "data" | "voice";
  severity: "required" | "recommended";
}

export function transcriptCleanupSkippedMessage(): string {
  return `Transcript cleanup needs an OpenAI API key (${rigSection("General")}). Using the raw transcription.`;
}

export function collectSetupGaps(input: {
  hasOpenAIApiKey: boolean;
  syncConfigured: boolean;
  platform: NodeJS.Platform;
  accessibilityTrusted?: boolean | null;
  parakeetModelInstalled?: boolean;
}): SetupGap[] {
  const gaps: SetupGap[] = [];

  if (!input.hasOpenAIApiKey) {
    gaps.push({
      kind: "openai_api_key",
      title: "OpenAI API key",
      detail:
        "Chat, polish, and optional transcript cleanup need an API key. Voice transcription runs locally on your Mac without one.",
      settingsTab: "general",
      severity: "required",
    });
  }

  if (input.platform === "darwin" && input.parakeetModelInstalled === false) {
    gaps.push({
      kind: "parakeet_model",
      title: "Voice transcription model",
      detail:
        "Voice dictation needs a one-time ~2.3 GB model download. Chat works without it.",
      settingsTab: "voice",
      severity: "recommended",
    });
  }

  if (!input.syncConfigured) {
    gaps.push({
      kind: "sync_r2",
      title: "Cloud sync (R2)",
      detail:
        "Connect a Cloudflare R2 bucket to sync conversations and settings across devices.",
      settingsTab: "data",
      severity: "recommended",
    });
  }

  if (input.platform === "darwin" && input.accessibilityTrusted === false) {
    gaps.push({
      kind: "macos_accessibility",
      title: "Accessibility permission",
      detail:
        "Required for the global Fn dictation shortcut when Harness is in the background.",
      settingsTab: "voice",
      severity: "recommended",
    });
  }

  return gaps;
}

/** Show the welcome setup notice when gaps remain and dismiss has not stuck for optional-only setups. */
export function shouldShowSetupNotice(gaps: SetupGap[], setupNoticeDismissed: boolean): boolean {
  if (gaps.length === 0) return false;
  if (gaps.some((gap) => gap.severity === "required")) return true;
  return !setupNoticeDismissed;
}
