/** Chat system prompt fields — from resources/contracts/systemPrompt.json (not settings-overridable). */

import contract from "../../resources/contracts/systemPrompt.json";

export interface SystemPromptFields {
  shared: string;
  desktop: string;
  ios: string;
}

interface SystemPromptContract {
  shared: string;
  desktop: string;
  ios: string;
}

const parsed = contract as SystemPromptContract;

export const DEFAULT_SYSTEM_PROMPT_SHARED = parsed.shared;
export const DEFAULT_SYSTEM_PROMPT_DESKTOP = parsed.desktop;
export const DEFAULT_SYSTEM_PROMPT_IOS = parsed.ios;

export const DEFAULT_SYSTEM_PROMPT: SystemPromptFields = {
  shared: DEFAULT_SYSTEM_PROMPT_SHARED,
  desktop: DEFAULT_SYSTEM_PROMPT_DESKTOP,
  ios: DEFAULT_SYSTEM_PROMPT_IOS,
};

/** Read-only helper: static portion (shared + platform overlay) for Settings preview display. */
export function assembleStaticSystemPrompt(
  fields: SystemPromptFields,
  platform: "desktop" | "ios",
): string {
  const overlay = platform === "ios" ? fields.ios : fields.desktop;
  return `${fields.shared}\n\n${overlay}`;
}
