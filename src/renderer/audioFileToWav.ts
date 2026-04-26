import { encodeWav } from "./recordingUtils";

function mixToMono(decoded: AudioBuffer): Float32Array {
  if (decoded.numberOfChannels <= 1) {
    return new Float32Array(decoded.getChannelData(0));
  }

  const out = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const source = decoded.getChannelData(channel);
    for (let i = 0; i < source.length; i += 1) {
      out[i] += source[i];
    }
  }
  const scale = 1 / decoded.numberOfChannels;
  for (let i = 0; i < out.length; i += 1) {
    out[i] *= scale;
  }
  return out;
}

export async function audioFileToWav(file: File): Promise<ArrayBuffer> {
  const bytes = await file.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(bytes.slice(0));
    const mono = mixToMono(decoded);
    return encodeWav([mono], decoded.sampleRate);
  } finally {
    await audioContext.close().catch(() => {});
  }
}
