import type { HarnessAPI } from "../../shared/desktopAPI";
import pkg from "../../../package.json";
import { createBrowserAdapter } from "../browser/browserAdapter";

/** A scripted assistant turn: held for `thinkMs` (the wait ticker shows), then streamed. */
export type DemoReply = { text: string; thinkMs?: number; charsPerChunk?: number; chunkMs?: number };

type Listener = (payload: never) => void;

/** Fn-dictation events the scene emits in place of the native recorder. */
export type DemoRecordingBus = {
  started: (info: { focused: boolean }) => void;
  stopped: () => void;
  transcribing: (info: { recordingPath: string | null }) => void;
  level: (level: number) => void;
  transcriptReady: (text: string) => void;
};

export type DemoBackend = {
  harness: HarnessAPI;
  recording: DemoRecordingBus;
  /** Queue the next assistant reply; replies are consumed in order. */
  queueReply: (reply: DemoReply) => void;
  /** Title returned for the next title request. */
  setTitle: (title: string) => void;
};

const OPENAI_PREFIX = "/openai/";

/**
 * The browser-shell adapter with the parts a demo needs to script: model
 * replies (via `/openai` fetches) and Fn dictation events.
 */
export function createDemoAdapter(): DemoBackend {
  const base = createBrowserAdapter();
  const listeners = new Map<string, Set<Listener>>();
  const on = (name: string) => (cb: Listener) => {
    let set = listeners.get(name);
    if (!set) listeners.set(name, (set = new Set()));
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  };
  const emit = (name: string, payload?: unknown) => {
    for (const cb of [...(listeners.get(name) ?? [])]) (cb as (p: unknown) => void)(payload);
  };

  const replies: DemoReply[] = [];
  let nextTitle = "";
  installScriptedOpenAi(
    () => replies.shift() ?? { text: "" },
    () => nextTitle,
  );

  const harness: HarnessAPI = {
    ...base,
    app: { ...base.app, getVersion: async () => pkg.version },
    env: { ...base.env, isHarnessDev: async () => false },
    recording: {
      ...base.recording,
      requestMicrophoneAccess: async () => true,
      microphonePermissionStatus: async () => "granted",
      onGlobalRecordingStarted: on("started"),
      onGlobalRecordingStopped: on("stopped"),
      onGlobalRecordingTranscribing: on("transcribing"),
      onGlobalRecordingCancelled: on("cancelled"),
      onGlobalRecordingRetrying: on("retrying"),
      onGlobalRecordingError: on("error"),
      onGlobalRecordingLevel: on("level"),
      onGlobalTranscriptReady: on("transcriptReady"),
      onGlobalTranscriptDelivered: on("transcriptDelivered"),
    } as HarnessAPI["recording"],
  };

  return {
    harness,
    recording: {
      started: (info) => emit("started", info),
      stopped: () => emit("stopped"),
      transcribing: (info) => emit("transcribing", info),
      level: (level) => emit("level", level),
      transcriptReady: (text) => emit("transcriptReady", text),
    },
    queueReply: (reply) => replies.push(reply),
    setTitle: (title) => {
      nextTitle = title;
    },
  };
}

/** Answer the browser shell's OpenAI calls with scripted SSE, paced by page timers. */
function installScriptedOpenAi(nextReply: () => DemoReply, title: () => string): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes(OPENAI_PREFIX)) return realFetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
    if (!body.stream) {
      return Response.json({ choices: [{ message: { content: title() } }] });
    }
    const reply = nextReply();
    const size = reply.charsPerChunk ?? 3;
    const chunks: string[] = [];
    for (let i = 0; i < reply.text.length; i += size) chunks.push(reply.text.slice(i, i + size));
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let i = 0;
        const push = () => {
          if (i >= chunks.length) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
          const frame = { choices: [{ delta: { content: chunks[i++] } }] };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
          setTimeout(push, reply.chunkMs ?? 24);
        };
        setTimeout(push, reply.thinkMs ?? 1600);
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  };
}
