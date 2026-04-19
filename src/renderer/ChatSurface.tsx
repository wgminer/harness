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
import { useChatScroll } from "./chatScrollUtils";

interface ChatSurfaceProps {
  chatAreaRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<HTMLDivElement | null>;
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
  sendTick: number;
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
  sendTick,
}: ChatSurfaceProps) {
  const [hasScrolled, setHasScrolled] = useState(false);
  const messagesInnerRef = useRef<HTMLDivElement>(null);

  const { slackPx } = useChatScroll({
    chatAreaRef,
    innerRef: messagesInnerRef,
    composerRef,
    sendTick,
    sending,
  });

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

  return (
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
      <div className="chat-area">
        <div
          ref={messagesInnerRef}
          className="chat-area-inner"
          data-testid={messagesTestId}
          style={{ paddingBottom: `${slackPx}px` }}
        >
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
      <div ref={composerRef} className="input-container input-container--sticky" data-testid={composerTestId}>
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
