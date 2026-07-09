/** Peak below this is treated as silence (float samples in [-1, 1]). */
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

export const NO_AUDIO_CAPTURED_MESSAGE =
  "No audio captured. Click in Harness once to enable the microphone, then try Fn again.";
