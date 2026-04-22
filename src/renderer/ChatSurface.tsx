import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject, UIEvent } from "react";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import {
  SCROLL_TOP_THRESHOLD,
  type Message,
  type ToolCallDisplay,
  type VoiceState,
} from "./chatHelpers";
import { useFollowChatLiveEdge } from "./chatLiveScroll";

interface ChatSurfaceProps {
  chatAreaRef: RefObject<HTMLDivElement>;
  composerRef: RefObject<HTMLDivElement>;
  headerContent: ReactNode;
  headerClassName?: string;
  displayMessages: Message[];
  copiedIndex: number | null;
  onCopied: (i: number | null) => void;
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
  focusComposerNonce?: number;
  messagesTestId: string;
  composerTestId: string;
}

export function ChatSurface({
  chatAreaRef,
  composerRef,
  headerContent,
  headerClassName,
  displayMessages,
  copiedIndex,
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
  focusComposerNonce,
  messagesTestId,
  composerTestId,
}: ChatSurfaceProps) {
  const [hasScrolled, setHasScrolled] = useState(false);
  const chatMessagesContentRef = useRef<HTMLDivElement>(null);
  const chatPaneRef = useRef<HTMLDivElement>(null);

  useFollowChatLiveEdge({
    scrollRef: chatAreaRef,
    sending,
    streamingContent,
    messageCount: displayMessages.length,
  });

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
        <div ref={chatMessagesContentRef} className="chat-area-inner" data-testid={messagesTestId}>
          <ChatMessageList
            displayMessages={displayMessages}
            copiedIndex={copiedIndex}
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
          focusComposerNonce={focusComposerNonce}
        />
      </div>
    </div>
  );
}
