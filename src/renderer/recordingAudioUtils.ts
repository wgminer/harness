export const SILENT_AUDIO_PEAK_THRESHOLD = 0.0001;

export function countSamples(buffers: Float32Array[]): number {
  return buffers.reduce((n, b) => n + b.length, 0);
}

export function peakAmplitude(buffers: Float32Array[]): number {
  let peak = 0;
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i++) {
      const abs = Math.abs(buf[i]);
      if (abs > peak) peak = abs;
    }
  }
  return peak;
}

export function isSilentAudio(buffers: Float32Array[]): boolean {
  if (countSamples(buffers) === 0) return true;
  return peakAmplitude(buffers) < SILENT_AUDIO_PEAK_THRESHOLD;
}

export const MICROPHONE_PERMISSION_DENIED_MESSAGE =
  "Microphone access is required. Enable Harness in System Settings → Privacy & Security → Microphone, then quit and reopen. If Harness is not listed, install a build that includes the microphone entitlement and try Ask For Microphone again.";

export const NO_AUDIO_CAPTURED_MESSAGE =
  "No audio captured. Check that your microphone is connected and not muted, then try again.";

export function silenceCaptureErrorMessage(microphoneAuthorized: boolean): string {
  return microphoneAuthorized
    ? NO_AUDIO_CAPTURED_MESSAGE
    : MICROPHONE_PERMISSION_DENIED_MESSAGE;
}