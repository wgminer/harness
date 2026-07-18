import { useMemo } from "react";
import { acquireRecordingStream, createRecordingAudioContext } from "./recordingBootstrap";
import { isSilentAudio, silenceCaptureErrorMessage } from "./recordingAudioUtils";
import { encodeWav, playStartChime, playStopChime } from "./recordingUtils";

export type Recorder = {
  start: () => Promise<void>;
  stop: (options?: { chime?: "stop" | "none" }) => Promise<ArrayBuffer>;
};

export function createRecorder(): Recorder {
  let audioCtx: AudioContext | null = null;
  let scriptProc: ScriptProcessorNode | null = null;
  let mediaStream: MediaStream | null = null;
  let pcmBuffers: Float32Array[] = [];
  let releaseStreamOnStop = false;

  async function start(): Promise<void> {
    await playStartChime();
    const { stream, releaseOnStop } = await acquireRecordingStream();
    mediaStream = stream;
    releaseStreamOnStop = releaseOnStop;
    const ctx = await createRecordingAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const buffers: Float32Array[] = [];
    processor.onaudioprocess = (e) => {
      buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    audioCtx = ctx;
    scriptProc = processor;
    pcmBuffers = buffers;
  }

  async function stop(options: { chime?: "stop" | "none" } = { chime: "stop" }): Promise<ArrayBuffer> {
    const ctx = audioCtx;
    const processor = scriptProc;
    const stream = mediaStream;
    const buffers = pcmBuffers;
    const sampleRate = ctx?.sampleRate ?? 44100;
    processor?.disconnect();
    if (releaseStreamOnStop) {
      stream?.getTracks().forEach((t) => t.stop());
    }
    audioCtx = null;
    scriptProc = null;
    mediaStream = null;
    pcmBuffers = [];
    releaseStreamOnStop = false;
    await ctx?.close().catch(() => {});
    if (options.chime === "stop") {
      await playStopChime();
    }
    if (isSilentAudio(buffers)) {
      let authorized = true;
      try {
        const status = await window.harness?.recording?.microphonePermissionStatus?.();
        if (status === "denied" || status === "undetermined") {
          authorized = false;
        } else if (status === "granted") {
          authorized = true;
        } else if (window.harness?.recording?.requestMicrophoneAccess) {
          authorized = await window.harness.recording.requestMicrophoneAccess();
        }
      } catch {
        authorized = false;
      }
      throw new Error(silenceCaptureErrorMessage(authorized));
    }
    return encodeWav(buffers, sampleRate);
  }

  return { start, stop };
}

export function useRecorder(): Recorder {
  return useMemo(() => createRecorder(), []);
}
