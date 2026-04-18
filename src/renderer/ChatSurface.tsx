import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject, UIEvent } from "react";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import {
  BOTTOM_SPACER_BEYOND_COMPOSER_PX,
  SCROLL_TOP_THRESHOLD,
  type Message,
  type ToolCallDisplay,
  type VoiceState,
} from "./chatHelpers";
import { alignLatestUserMessageToTop, chatAreaMetrics, devLogChatScroll } from "./chatScrollUtils";

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
  alignLatestUserMessageRequestId: number;
  scrollDebugPrefix?: string;
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
  alignLatestUserMessageRequestId,
  scrollDebugPrefix,
}: ChatSurfaceProps) {
  const [hasScrolled, setHasScrolled] = useState(false);
  const [bottomSpacerPx, setBottomSpacerPx] = useState(200);
  const [tailRoomPx, setTailRoomPx] = useState(280);
  const lastHandledAlignRequestIdRef = useRef(0);
  const chatAreaInnerPaddingBottomPx = bottomSpacerPx + tailRoomPx;

  const logScope = scrollDebugPrefix ?? "chat-scroll";
  const logScrollDebug = useCallback(
    (event: string, details: Record<string, unknown> = {}) => {
      devLogChatScroll(logScope, event, details);
    },
    [logScope]
  );

  const onChatAreaScroll = useCallback((_e: UIEvent<HTMLDivElement>) => {
    const el = chatAreaRef.current;
    if (!el) return;
    setHasScrolled(el.scrollTop > SCROLL_TOP_THRESHOLD);
  }, [chatAreaRef]);

  const scrollToTop = useCallback(() => {
    chatAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [chatAreaRef]);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    const chatArea = chatAreaRef.current;
    if (!composer || !chatArea) return;
    const update = () => {
      const composerHeight = Math.ceil(composer.getBoundingClientRect().height);
      const measured = composerHeight + BOTTOM_SPACER_BEYOND_COMPOSER_PX;
      setBottomSpacerPx((prev) => (prev !== measured ? measured : prev));
      const chatAreaHeight = Math.ceil(chatArea.getBoundingClientRect().height);
      const responsiveTailRoom = Math.round(Math.max(220, Math.min(520, chatAreaHeight * 0.55)));
      setTailRoomPx((prev) => (prev !== responsiveTailRoom ? responsiveTailRoom : prev));
    };
    update();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(composer);
    }
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [chatAreaRef, composerRef]);

  // Align on explicit request ids from parent; chunk streaming does not trigger this effect.
  useLayoutEffect(() => {
    if (
      alignLatestUserMessageRequestId < 1 ||
      alignLatestUserMessageRequestId === lastHandledAlignRequestIdRef.current
    ) {
      return;
    }
    const chatArea = chatAreaRef.current;
    if (!chatArea) return;
    lastHandledAlignRequestIdRef.current = alignLatestUserMessageRequestId;
    const alignLatestUserMessage = (phase: "layout" | "raf") => {
      const result = alignLatestUserMessageToTop(chatArea);
      if (!result.aligned) {
        logScrollDebug("align-skip", {
          phase,
          requestId: alignLatestUserMessageRequestId,
          reason: result.skippedReason ?? "unknown",
          ...chatAreaMetrics(chatArea),
        });
        return false;
      }
      logScrollDebug("align-before-scroll", {
        phase,
        requestId: alignLatestUserMessageRequestId,
        targetTop: result.targetTop,
        userTopDelta: result.userTopDelta,
        ...chatAreaMetrics(chatArea),
      });
      logScrollDebug("align-after-scroll", {
        phase,
        requestId: alignLatestUserMessageRequestId,
        currentScrollTop: chatArea.scrollTop,
        targetTop: result.targetTop,
      });
      return true;
    };
    alignLatestUserMessage("layout");
    const rafId = requestAnimationFrame(() => alignLatestUserMessage("raf"));
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [alignLatestUserMessageRequestId, chatAreaRef, logScrollDebug]);

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
          className="chat-area-inner"
          data-testid={messagesTestId}
          style={{ paddingBottom: `${chatAreaInnerPaddingBottomPx}px` }}
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
