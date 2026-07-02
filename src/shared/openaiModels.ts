/**
 * Fixed OpenAI models for chat, titles, and transcript cleanup.
 * Update here when upgrading defaults (no user-facing model picker).
 */
export const OPENAI_CHAT_MODEL = "gpt-5.4";

/** Short, cheap title generation. */
export const OPENAI_TITLE_MODEL = "gpt-5.4-nano";

/** Transcript cleanup / light rewriting after on-device speech transcription. */
export const OPENAI_TRANSCRIPT_CLEANUP_MODEL = "gpt-5.4-mini";
