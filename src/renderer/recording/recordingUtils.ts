import type { RecordingChime } from "../../shared/desktopAPI";

export function encodeWav(buffers: Float32Array[], sampleRate: number): ArrayBuffer {
  const totalSamples = buffers.reduce((n, b) => n + b.length, 0);
  const dataBytes = totalSamples * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const str = (s: string, off: number) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str("RIFF", 0);
  view.setUint32(4, 36 + dataBytes, true);
  str("WAVE", 8);
  str("fmt ", 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str("data", 36);
  view.setUint32(40, dataBytes, true);
  let off = 44;
  for (const b of buffers) {
    for (let i = 0; i < b.length; i++) {
      const s = Math.max(-1, Math.min(1, b[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return buf;
}

export function playTone(
  frequency: number,
  durationSec: number,
  type: OscillatorType = "sine",
  gain = 0.18
): Promise<void> {
  return new Promise((resolve) => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const vol = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    vol.gain.setValueAtTime(gain, ctx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
    osc.connect(vol);
    vol.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationSec);
    osc.onended = () => { ctx.close(); resolve(); };
  });
}

const WEB_CHIME_NOTES: Record<RecordingChime, [number, number][]> = {
  start: [[660, 0.08], [880, 0.12]],
  stop: [[550, 0.08], [440, 0.15]],
  done: [[784, 0.07], [988, 0.07], [1319, 0.16]],
  cancel: [[330, 0.06], [220, 0.18]],
};

/** Web Audio fallback for the browser debug shell; desktop plays cues natively. */
export async function playWebChime(kind: RecordingChime): Promise<void> {
  for (const [frequency, duration] of WEB_CHIME_NOTES[kind]) {
    await playTone(frequency, duration);
  }
}

/** Resolves once the cue has played; errors are swallowed so a cue never blocks recording. */
function playChime(kind: RecordingChime): Promise<void> {
  return window.harness.recording.playChime(kind).catch(() => {});
}

export function playStartChime(): Promise<void> {
  return playChime("start");
}

export function playStopChime(): Promise<void> {
  return playChime("stop");
}

export function playDoneChime(): Promise<void> {
  return playChime("done");
}

export function playCancelChime(): Promise<void> {
  return playChime("cancel");
}
