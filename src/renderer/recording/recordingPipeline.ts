export type TranscribeResult =
  | { text: string; cleanupSkipped?: "no_api_key"; path?: string }
  | { error: string };

export async function transcribeWav(wav: ArrayBuffer): Promise<TranscribeResult> {
  let path: string | undefined;
  try {
    const saved = await window.harness.recording.saveWav(wav);
    path = saved.path;
  } catch {
    // Saving is best-effort; transcription can still proceed.
  }
  const result = await window.harness.recording.transcribe(wav);
  if ("error" in result) {
    return { error: result.error };
  }
  return { text: result.text, cleanupSkipped: result.cleanupSkipped, path };
}
