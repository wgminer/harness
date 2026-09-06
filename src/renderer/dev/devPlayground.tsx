import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { ChatSurface } from "../ChatSurface";
import { DictationSuggestedPromptChips } from "../DictationSuggestedPromptChips";
import type { Message } from "../chatHelpers";
import {
  DEV_CHAT_ASSISTANT_1,
  DEV_CHAT_ASSISTANT_2,
  DEV_CHAT_USER_1,
  DEV_CHAT_USER_2,
  DEV_DICTATION_FIXTURE,
  DEV_STREAM_FIXTURE,
  streamText,
  useMockAssistantStream,
  waitMs,
  type MockStreamSpeed,
} from "./useMockAssistantStream";
import "./dev.css";

const USER_MESSAGE_ID = "dev-dictation-user";
const ASSISTANT_MESSAGE_ID = "dev-dictation-assistant";

/** Hold the empty assistant slot so the stream wait ticker can run. */
const DEV_STREAM_WAIT_MS = 40000;

function DevControlsDock({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className="dev-controls-dock" role="toolbar" aria-label="Dev controls">
      {children}
    </div>
  );
}

function DevDictationTest({
  onShowResetChange,
  resetRef,
}: {
  onShowResetChange: (show: boolean) => void;
  resetRef: MutableRefObject<(() => void) | null>;
}) {
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: USER_MESSAGE_ID,
      role: "user",
      content: DEV_DICTATION_FIXTURE,
      timestamp: Date.now(),
    },
  ]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const { content: streamContent, isStreaming, start, reset } = useMockAssistantStream(
    DEV_STREAM_FIXTURE,
  );

  const hasAssistant = messages.some((m) => m.id === ASSISTANT_MESSAGE_ID);

  useEffect(() => {
    if (!hasAssistant) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === ASSISTANT_MESSAGE_ID ? { ...m, content: streamContent } : m,
      ),
    );
  }, [hasAssistant, streamContent]);

  const handleRun = useCallback(() => {
    reset();
    setMessages((prev) => {
      const userOnly = prev.filter((m) => m.id === USER_MESSAGE_ID);
      return [
        ...userOnly,
        {
          id: ASSISTANT_MESSAGE_ID,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        },
      ];
    });
    start();
  }, [reset, start]);

  const handleReset = useCallback(() => {
    reset();
    setMessages([
      {
        id: USER_MESSAGE_ID,
        role: "user",
        content: DEV_DICTATION_FIXTURE,
        timestamp: Date.now(),
      },
    ]);
  }, [reset]);

  resetRef.current = handleReset;

  const awaitingReply =
    messages.length === 1 && messages[0]?.role === "user" && !isStreaming;
  const hideComposer = awaitingReply;

  useEffect(() => {
    onShowResetChange(!awaitingReply);
  }, [awaitingReply, onShowResetChange]);

  const replyModeControl = awaitingReply ? (
    <DictationSuggestedPromptChips prompts={["Run"]} onSelect={handleRun} />
  ) : null;

  return (
    <div className="dev-chat-panel">
      <ChatSurface
        chatAreaRef={chatAreaRef}
        composerRef={composerRef}
        displayMessages={messages}
        copiedId={copiedId}
        savedToNotesId={null}
        onCopied={setCopiedId}
        onSaveToNotes={() => {}}
        streamingContent={hasAssistant ? streamContent : ""}
        sending={hasAssistant && (isStreaming || streamContent.length < DEV_STREAM_FIXTURE.length)}
        polishHintAfterDictation={false}
        llmActionsEnabled={false}
        onToolConfirm={() => {}}
        onPolish={() => {}}
        replyModeControl={replyModeControl}
        input={input}
        onInputChange={setInput}
        onSend={() => {}}
        onStop={() => {}}
        voiceState="idle"
        voiceError={null}
        recordingMs={0}
        onStartRecording={() => {}}
        onStopRecording={() => {}}
        onCancelRecording={() => {}}
        attachedAudioName={null}
        attachmentTranscribing={false}
        attachmentError={null}
        onAttachAudio={() => {}}
        onRemoveAttachedAudio={() => {}}
        messagesTestId="dev-dictation-messages"
        composerTestId="dev-dictation-composer"
        inputRef={inputRef}
        hideComposer={hideComposer}
      />
    </div>
  );
}

function DevChatStreamTest({
  speed,
  startRef,
  resetRef,
  onStreamingChange,
}: {
  speed: MockStreamSpeed;
  startRef: MutableRefObject<(() => void) | null>;
  resetRef: MutableRefObject<(() => void) | null>;
  onStreamingChange: (streaming: boolean) => void;
}) {
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const scriptGenRef = useRef(0);

  const reset = useCallback(() => {
    scriptGenRef.current += 1;
    setMessages([]);
    setSending(false);
    setStreamingAssistantId(null);
    onStreamingChange(false);
  }, [onStreamingChange]);

  const start = useCallback(async () => {
    const generation = ++scriptGenRef.current;
    const isCancelled = () => scriptGenRef.current !== generation;
    onStreamingChange(true);
    setMessages([]);
    setSending(false);
    setStreamingAssistantId(null);

    const makeId = (role: string, turn: number) => `dev-chat-${role}-${turn}`;

    try {
      setMessages([
        {
          id: makeId("user", 1),
          role: "user",
          content: DEV_CHAT_USER_1,
          timestamp: Date.now(),
        },
      ]);
      await waitMs(450, isCancelled);

      const assistant1Id = makeId("assistant", 1);
      setMessages((prev) => [
        ...prev,
        { id: assistant1Id, role: "assistant", content: "", timestamp: Date.now() },
      ]);
      setStreamingAssistantId(assistant1Id);
      setSending(true);
      await waitMs(DEV_STREAM_WAIT_MS, isCancelled);

      await streamText(
        DEV_CHAT_ASSISTANT_1,
        speed,
        (content) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistant1Id ? { ...m, content } : m)),
          );
        },
        isCancelled,
      );
      setSending(false);
      setStreamingAssistantId(null);
      await waitMs(700, isCancelled);

      setMessages((prev) => [
        ...prev,
        {
          id: makeId("user", 2),
          role: "user",
          content: DEV_CHAT_USER_2,
          timestamp: Date.now(),
        },
      ]);
      await waitMs(450, isCancelled);

      const assistant2Id = makeId("assistant", 2);
      setMessages((prev) => [
        ...prev,
        { id: assistant2Id, role: "assistant", content: "", timestamp: Date.now() },
      ]);
      setStreamingAssistantId(assistant2Id);
      setSending(true);
      await waitMs(DEV_STREAM_WAIT_MS, isCancelled);

      await streamText(
        DEV_CHAT_ASSISTANT_2,
        speed,
        (content) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistant2Id ? { ...m, content } : m)),
          );
        },
        isCancelled,
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        throw err;
      }
    } finally {
      if (scriptGenRef.current === generation) {
        setSending(false);
        setStreamingAssistantId(null);
        onStreamingChange(false);
      }
    }
  }, [onStreamingChange, speed]);

  startRef.current = () => {
    void start();
  };
  resetRef.current = reset;

  const streamingContent =
    streamingAssistantId != null
      ? messages.find((m) => m.id === streamingAssistantId)?.content ?? ""
      : "";

  return (
    <div className="dev-chat-panel">
      <ChatSurface
        chatAreaRef={chatAreaRef}
        composerRef={composerRef}
        displayMessages={messages}
        copiedId={copiedId}
        savedToNotesId={null}
        onCopied={setCopiedId}
        onSaveToNotes={() => {}}
        streamingContent={streamingContent}
        sending={sending}
        polishHintAfterDictation={false}
        llmActionsEnabled={false}
        onToolConfirm={() => {}}
        onPolish={() => {}}
        input={input}
        onInputChange={setInput}
        onSend={() => {}}
        onStop={() => {}}
        voiceState="idle"
        voiceError={null}
        recordingMs={0}
        onStartRecording={() => {}}
        onStopRecording={() => {}}
        onCancelRecording={() => {}}
        attachedAudioName={null}
        attachmentTranscribing={false}
        attachmentError={null}
        onAttachAudio={() => {}}
        onRemoveAttachedAudio={() => {}}
        messagesTestId="dev-chat-messages"
        composerTestId="dev-chat-composer"
        inputRef={inputRef}
      />
    </div>
  );
}

export function DevDictationView() {
  const [showReset, setShowReset] = useState(false);
  const resetRef = useRef<(() => void) | null>(null);

  return (
    <div className="dev-surface-view">
      <DevDictationTest onShowResetChange={setShowReset} resetRef={resetRef} />
      <DevControlsDock>
        {showReset ? (
          <button
            type="button"
            className="btn btn-compact chat-pane-btn"
            onClick={() => resetRef.current?.()}
          >
            Reset
          </button>
        ) : null}
      </DevControlsDock>
    </div>
  );
}

export function DevChatView() {
  const [streamSpeed, setStreamSpeed] = useState<MockStreamSpeed>("normal");
  const [streamBusy, setStreamBusy] = useState(false);
  const streamStartRef = useRef<(() => void) | null>(null);
  const streamResetRef = useRef<(() => void) | null>(null);

  return (
    <div className="dev-surface-view">
      <DevChatStreamTest
        speed={streamSpeed}
        startRef={streamStartRef}
        resetRef={streamResetRef}
        onStreamingChange={setStreamBusy}
      />
      <DevControlsDock>
        <button
          type="button"
          className="btn btn-compact chat-pane-btn"
          onClick={() => streamStartRef.current?.()}
          disabled={streamBusy}
        >
          Start
        </button>
        <button
          type="button"
          className="btn btn-compact chat-pane-btn"
          onClick={() => streamResetRef.current?.()}
        >
          Reset
        </button>
        <div className="dev-stream-controls__speed">
          <label htmlFor="dev-stream-speed">Speed</label>
          <select
            id="dev-stream-speed"
            value={streamSpeed}
            onChange={(e) => setStreamSpeed(e.target.value as MockStreamSpeed)}
            disabled={streamBusy}
          >
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
          </select>
        </div>
      </DevControlsDock>
    </div>
  );
}

export function DevPlaceholderView({ kind }: { kind: "note" | "image" }) {
  const label = kind === "note" ? "Note" : "Image";
  return (
    <div className="workspace-page dev-placeholder-page">
      <header className="workspace-header">
        <div className="workspace-header-inner">
          <div className="workspace-header-title-row">
            <h1 className="workspace-title">Dev · {label}</h1>
          </div>
        </div>
      </header>
      <div className="workspace-scroll">
        <div className="workspace-content">
          <div className="workspace-stack">
            <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: "var(--font-size-caption)" }}>
              Coming soon.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
