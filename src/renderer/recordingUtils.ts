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

export async function playStartChime(): Promise<void> {
  await playTone(660, 0.08);
  await playTone(880, 0.12);
}

export async function playStopChime(): Promise<void> {
  await playTone(550, 0.08);
  await playTone(440, 0.15);
}

export async function playCancelChime(): Promise<void> {
  await playTone(330, 0.06);
  await playTone(220, 0.18);
}
