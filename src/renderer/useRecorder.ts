import { useRef } from "react";
import { encodeWav, playStartChime, playStopChime } from "./recordingUtils";

export function useRecorder() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scriptProcRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pcmBuffersRef = useRef<Float32Array[]>([]);

  async function start(): Promise<void> {
    await playStartChime();
    if (typeof window !== "undefined" && window.electron?.recording?.requestMicrophoneAccess) {
      const ok = await window.electron.recording.requestMicrophoneAccess();
      if (!ok) {
        throw new Error("Microphone access denied.");
      }
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    // createScriptProcessor is deprecated but reliable in Electron's pinned Chromium
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const buffers: Float32Array[] = [];
    processor.onaudioprocess = (e) => {
      buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    audioCtxRef.current = ctx;
    scriptProcRef.current = processor;
    mediaStreamRef.current = stream;
    pcmBuffersRef.current = buffers;
  }

  async function stop(): Promise<ArrayBuffer> {
    const ctx = audioCtxRef.current;
    const processor = scriptProcRef.current;
    const stream = mediaStreamRef.current;
    const buffers = pcmBuffersRef.current;
    processor?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current = null;
    scriptProcRef.current = null;
    mediaStreamRef.current = null;
    pcmBuffersRef.current = [];
    playStopChime();
    const sampleRate = ctx?.sampleRate ?? 44100;
    await ctx?.close().catch(() => {});
    return encodeWav(buffers, sampleRate);
  }

  return { start, stop };
}
