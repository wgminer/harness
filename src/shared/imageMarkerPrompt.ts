/**
 * Marker-region adjust prompt prefix — from resources/contracts/imageMarkerPrompt.json.
 *
 * The renderer prepends this before calling `images.generate` for marker edits;
 * the backend does not inject it (keeps generate input explicit on the wire).
 */

import contract from "../../resources/contracts/imageMarkerPrompt.json";

export interface ImageMarkerPromptContract {
  prefix: string;
}

const parsed = contract as ImageMarkerPromptContract;

export const IMAGE_MARKER_PROMPT_PREFIX = parsed.prefix;

/** Prepend the contract prefix to a user prompt for marker-based adjust. */
export function buildMarkerAdjustPrompt(userPrompt: string): string {
  const trimmed = userPrompt.trim();
  if (!trimmed) return IMAGE_MARKER_PROMPT_PREFIX;
  return `${IMAGE_MARKER_PROMPT_PREFIX}\n\n${trimmed}`;
}
