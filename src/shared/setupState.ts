import { rigSection } from "./rigPage";
import type { Settings } from "./types";

export type SetupGapKind = "openai_api_key" | "backup_folder" | "macos_accessibility";

export interface SetupGap {
  kind: SetupGapKind;
  title: string;
  detail: string;
  /** Settings tab to open when the user chooses "Set up". */
  settingsTab: "general" | "data" | "voice";
  severity: "required" | "recommended";
}

export function hasOpenAIApiKey(
  settings: Pick<Settings, "openai"> | { openai?: { apiKey?: string } }
): boolean {
  return Boolean(settings.openai?.apiKey?.trim());
}

export function openAIRequiredMessage(): string {
  return `Add an OpenAI API key in ${rigSection("General")} to use chat and other AI features. Voice transcription still works without a key.`;
}

export function transcriptCleanupSkippedMessage(): string {
  return `Transcript cleanup needs an OpenAI API key (${rigSection("General")}). Using the raw transcription.`;
}

export function collectSetupGaps(input: {
  settings: Settings;
  syncConfigured: boolean;
  platform: NodeJS.Platform;
  accessibilityTrusted?: boolean | null;
}): SetupGap[] {
  const gaps: SetupGap[] = [];

  if (!hasOpenAIApiKey(input.settings)) {
    gaps.push({
      kind: "openai_api_key",
      title: "OpenAI API key",
      detail:
        "Chat, polish, and optional transcript cleanup need an API key. Voice transcription runs locally on your Mac without one.",
      settingsTab: "general",
      severity: "required",
    });
  }

  if (!input.syncConfigured) {
    gaps.push({
      kind: "backup_folder",
      title: "Backup folder",
      detail:
        "Link a folder (iCloud, Dropbox, etc.) to sync conversations and settings across devices.",
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
