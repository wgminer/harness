import { rigSection } from "./rigPage";

export type SetupGapKind = "openai_api_key" | "sync_r2" | "macos_accessibility";

export interface SetupGap {
  kind: SetupGapKind;
  title: string;
  detail: string;
  /** Settings tab to open when the user chooses "Set up". */
  settingsTab: "general" | "data" | "voice";
  severity: "required" | "recommended";
}

export function transcriptCleanupSkippedMessage(): string {
  return `Transcript cleanup needs an OpenAI API key (${rigSection("Data")}). Using the raw transcription.`;
}

export function chatRequiresApiKeyMessage(): string {
  return `Chat needs an OpenAI API key in ${rigSection("Data")}.`;
}

export function collectSetupGaps(input: {
  hasOpenAIApiKey: boolean;
  syncConfigured: boolean;
  platform: NodeJS.Platform;
  accessibilityTrusted?: boolean | null;
}): SetupGap[] {
  const gaps: SetupGap[] = [];

  if (!input.hasOpenAIApiKey) {
    gaps.push({
      kind: "openai_api_key",
      title: "OpenAI API key",
      detail:
        "Chat, polish, and optional transcript cleanup need an API key. Voice transcription runs locally on your Mac without one.",
      settingsTab: "data",
      severity: "required",
    });
  }

  if (!input.syncConfigured) {
    gaps.push({
      kind: "sync_r2",
      title: "Cloud sync (R2)",
      detail:
        "Connect a Cloudflare R2 bucket to sync conversations and settings across devices.",
      settingsTab: "general",
      severity: "recommended",
    });
  }

  if (input.platform === "darwin" && input.accessibilityTrusted === false) {
    gaps.push({
      kind: "macos_accessibility",
      title: "Accessibility permission",
      detail:
        "Required for the global Fn dictation shortcut when Harness is in the background.",
      settingsTab: "general",
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
