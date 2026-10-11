import { acquireRecordingStream, createRecordingAudioContext } from "./recordingBootstrap";
import { isSilentAudio, silenceCaptureErrorMessage } from "./recordingAudioUtils";
import { encodeWav, playStartChime, playStopChime } from "./recordingUtils";

export type Recorder = {
  start: () => Promise<void>;
  stop: (options?: { chime?: "stop" | "none" }) => Promise<ArrayBuffer>;
  /** Drop the take and release the mic; safe to call in any state. */
  cancel: () => Promise<void>;
};

export type RecorderOptions = {
  /** Peak amplitude (0..1) of each captured buffer, for level meters. */
  onLevel?: (level: number) => void;
};

export function createRecorder({ onLevel }: RecorderOptions = {}): Recorder {
  let audioCtx: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let pcmBuffers: Float32Array[] = [];

  /** Release the mic and audio context; returns what the take captured. */
  async function teardown(): Promise<{ buffers: Float32Array[]; sampleRate: number }> {
    const ctx = audioCtx;
    const buffers = pcmBuffers;
    mediaStream?.getTracks().forEach((t) => t.stop());
    audioCtx = null;
    mediaStream = null;
    pcmBuffers = [];
    await ctx?.close().catch(() => {});
    return { buffers, sampleRate: ctx?.sampleRate ?? 44100 };
  }

  async function start(): Promise<void> {
    await playStartChime();
    try {
      mediaStream = await acquireRecordingStream();
      audioCtx = await createRecordingAudioContext();
    } catch (err) {
      await teardown();
      throw err;
    }
    const source = audioCtx.createMediaStreamSource(mediaStream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    const buffers: Float32Array[] = [];
    processor.onaudioprocess = (e) => {
      const samples = new Float32Array(e.inputBuffer.getChannelData(0));
      buffers.push(samples);
      if (onLevel) {
        let peak = 0;
        for (let i = 0; i < samples.length; i++) {
          const abs = Math.abs(samples[i]!);
          if (abs > peak) peak = abs;
        }
        onLevel(peak);
      }
    };
    source.connect(processor);
    processor.connect(audioCtx.destination);
    pcmBuffers = buffers;
  }

  async function stop(options: { chime?: "stop" | "none" } = { chime: "stop" }): Promise<ArrayBuffer> {
    const { buffers, sampleRate } = await teardown();
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

  return {
    start,
    stop,
    cancel: async () => {
      await teardown();
    },
  };
}
