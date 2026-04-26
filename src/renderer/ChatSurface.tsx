import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject, ReactNode, RefObject, UIEvent } from "react";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import {
  SCROLL_TOP_THRESHOLD,
  type Message,
  type ToolCallDisplay,
  type VoiceState,
} from "./chatHelpers";
import {
  LIVE_EDGE_TOLERANCE_PX,
  distanceFromLiveEdge,
  useFollowChatLiveEdge,
} from "./chatLiveScroll";

interface ChatSurfaceProps {
  chatAreaRef: RefObject<HTMLDivElement>;
  composerRef: RefObject<HTMLDivElement>;
  headerContent: ReactNode;
  headerClassName?: string;
  displayMessages: Message[];
  copiedId: string | null;
  onCopied: (id: string | null) => void;
  streamingContent: string;
  sending: boolean;
  polishHintAfterDictation: boolean;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
  onPolish: () => void;
  onGenerateReply: () => void;
  input: string;
  onInputChange: (next: string) => void;
  onSend: () => void | Promise<void>;
  onStop: () => void;
  voiceState: VoiceState;
  voiceError: string | null;
  recordingMs: number;
  onStartRecording: () => void | Promise<void>;
  onStopRecording: () => void | Promise<void>;
  onCancelRecording: () => void | Promise<void>;
  attachedAudioName: string | null;
  attachmentTranscribing: boolean;
  attachmentError: string | null;
  onAttachAudio: (file: File | null) => void;
  onRemoveAttachedAudio: () => void;
  focusComposerNonce?: number;
  messagesTestId: string;
  composerTestId: string;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
}

export function ChatSurface({
  chatAreaRef,
  composerRef,
  headerContent,
  headerClassName,
  displayMessages,
  copiedId,
  onCopied,
  streamingContent,
  sending,
  polishHintAfterDictation,
  onToolConfirm,
  onPolish,
  onGenerateReply,
  input,
  onInputChange,
  onSend,
  onStop,
  voiceState,
  voiceError,
  recordingMs,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  attachedAudioName,
  attachmentTranscribing,
  attachmentError,
  onAttachAudio,
  onRemoveAttachedAudio,
  focusComposerNonce,
  messagesTestId,
  composerTestId,
  inputRef,
}: ChatSurfaceProps) {
  const [hasScrolled, setHasScrolled] = useState(false);
  const [followLiveEdge, setFollowLiveEdge] = useState(true);
  const chatPaneRef = useRef<HTMLDivElement>(null);

  useFollowChatLiveEdge({
    scrollRef: chatAreaRef,
    followLiveEdge,
    sending,
    streamingContent,
    messageCount: displayMessages.length,
  });

  useLayoutEffect(() => {
    if (!sending) return;
    setFollowLiveEdge(true);
  }, [sending]);

  /** Keep scroll padding in sync with the overlay composer height (textarea auto-grow, errors). */
  useLayoutEffect(() => {
    const pane = chatPaneRef.current;
    const dock = composerRef.current;
    if (!pane || !dock) return;

    const sync = () => {
      const h = Math.ceil(dock.getBoundingClientRect().height);
      pane.style.setProperty("--chat-composer-dock-height", `${h}px`);
    };

    sync();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(sync);
      ro.observe(dock);
    }

    window.addEventListener("resize", sync);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [composerRef]);

  const onChatAreaScroll = useCallback((_e: UIEvent<HTMLDivElement>) => {
    const el = chatAreaRef.current;
    if (!el) return;
    setHasScrolled(el.scrollTop > SCROLL_TOP_THRESHOLD);
    const nearLiveEdge = distanceFromLiveEdge(el) <= LIVE_EDGE_TOLERANCE_PX;
    setFollowLiveEdge(nearLiveEdge);
  }, [chatAreaRef]);

  const scrollToTop = useCallback(() => {
    chatAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [chatAreaRef]);

  useLayoutEffect(() => {
    if (focusComposerNonce == null || focusComposerNonce < 1) return;
    composerRef.current?.querySelector<HTMLTextAreaElement>(".chat-input")?.focus();
  }, [composerRef, focusComposerNonce]);

  /*
   * `.chat-pane` is `position: relative`. `.chat-scroll` fills it and scrolls; bottom padding matches
   * the overlay `.chat-composer-dock` via `--chat-composer-dock-height`.
   */
  return (
    <div ref={chatPaneRef} className="chat-pane">
      <div
        ref={chatAreaRef}
        className="chat-scroll"
        data-scrolled={hasScrolled || undefined}
        onScroll={onChatAreaScroll}
      >
        {hasScrolled && (
          <button
            type="button"
            className="chat-scroll-top"
            onClick={scrollToTop}
            aria-label="Scroll to top"
          >
            Top
          </button>
        )}
        <header className={headerClassName ? `chat-pane-header ${headerClassName}` : "chat-pane-header"}>
          {headerContent}
        </header>
        <div className="chat-area-inner" data-testid={messagesTestId}>
          <ChatMessageList
            displayMessages={displayMessages}
            copiedId={copiedId}
            onCopied={onCopied}
            streamingContent={streamingContent}
            sending={sending}
            polishHintAfterDictation={polishHintAfterDictation}
            onToolConfirm={onToolConfirm}
            onPolish={onPolish}
            onGenerateReply={onGenerateReply}
          />
        </div>
      </div>
      <div
        ref={composerRef}
        className="chat-composer-dock"
        data-testid={composerTestId}
        role="group"
        aria-label="Message composer"
      >
        <ChatComposer
          input={input}
          onInputChange={onInputChange}
          onSend={onSend}
          onStop={onStop}
          sending={sending}
          voiceState={voiceState}
          voiceError={voiceError}
          recordingMs={recordingMs}
          onStartRecording={onStartRecording}
          onStopRecording={onStopRecording}
          onCancelRecording={onCancelRecording}
          attachedAudioName={attachedAudioName}
          attachmentTranscribing={attachmentTranscribing}
          attachmentError={attachmentError}
          onAttachAudio={onAttachAudio}
          onRemoveAttachedAudio={onRemoveAttachedAudio}
          focusComposerNonce={focusComposerNonce}
          inputRef={inputRef}
        />
      </div>
    </div>
  );
}
