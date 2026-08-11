import { useLayoutEffect, useRef } from "react";
import type { MutableRefObject, ReactNode, RefObject } from "react";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { ChatSelectionImagePopover } from "./ChatSelectionImagePopover";
import {
  type Message,
  type ToolCallDisplay,
  type VoiceState,
  type LiveNoteStream,
} from "./chatHelpers";
import { useChatScrollController } from "./chatScroll/useChatScrollController";

export type { LiveNoteStream } from "./chatHelpers";

interface ChatSurfaceProps {
  chatAreaRef: RefObject<HTMLDivElement>;
  composerRef: RefObject<HTMLDivElement>;
  headerContent: ReactNode;
  headerClassName?: string;
  displayMessages: Message[];
  copiedId: string | null;
  savedToNotesId: string | null;
  onCopied: (id: string | null) => void;
  onSaveToNotes: (id: string, content: string, messageTimestamp?: number) => void | Promise<void>;
  streamingContent: string;
  sending: boolean;
  polishHintAfterDictation: boolean;
  llmActionsEnabled?: boolean;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
  onPolish: () => void;
  /** Reply-strip controls while awaiting a reply (suggested prompts or mode picker). */
  replyModeControl?: ReactNode;
  onOptionSelect?: (label: string) => void | Promise<void>;
  liveNoteStream?: LiveNoteStream | null;
  onOpenNoteInEditor?: (noteId: string) => void;
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
  onAttachmentError?: (message: string | null) => void;
  focusComposerNonce?: number;
  messagesTestId: string;
  composerTestId: string;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  modeControl?: ReactNode;
  onCycleMode?: () => void;
}

export function ChatSurface({
  chatAreaRef,
  composerRef,
  headerContent,
  headerClassName,
  displayMessages,
  copiedId,
  savedToNotesId,
  onCopied,
  onSaveToNotes,
  streamingContent,
  sending,
  polishHintAfterDictation,
  llmActionsEnabled = true,
  onToolConfirm,
  onPolish,
  replyModeControl,
  onOptionSelect,
  liveNoteStream,
  onOpenNoteInEditor,
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
  onAttachmentError,
  focusComposerNonce,
  messagesTestId,
  composerTestId,
  inputRef,
  placeholder,
  modeControl,
  onCycleMode,
}: ChatSurfaceProps) {
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const centerSingleMessage =
    displayMessages.length === 1 && !sending && !streamingContent;

  const { onScroll, onKeyDown } = useChatScrollController({
    scrollRef: chatAreaRef,
    transcriptRef,
    chatPaneRef,
    composerDockRef: composerRef,
    scrollEnabled: !centerSingleMessage,
    sending,
  });

  useLayoutEffect(() => {
    if (focusComposerNonce == null || focusComposerNonce < 1) return;
    composerRef.current?.querySelector<HTMLTextAreaElement>(".chat-input")?.focus();
  }, [composerRef, focusComposerNonce]);

  /*
   * `.chat-pane` is `position: relative`. `.chat-scroll` fills it and scrolls; bottom inset
   * padding matches the overlay `.chat-composer-dock` via `--chat-composer-dock-height`.
   */
  return (
    <div ref={chatPaneRef} className="chat-pane">
      <div
        ref={chatAreaRef}
        className={centerSingleMessage ? "chat-scroll chat-scroll--single-message" : "chat-scroll"}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        tabIndex={-1}
      >
        <header className={headerClassName ? `chat-pane-header ${headerClassName}` : "chat-pane-header"}>
          {headerContent}
        </header>
        <div ref={transcriptRef} className="chat-area-inner" data-testid={messagesTestId}>
          <ChatMessageList
            displayMessages={displayMessages}
            copiedId={copiedId}
            savedToNotesId={savedToNotesId}
            onCopied={onCopied}
            onSaveToNotes={onSaveToNotes}
            streamingContent={streamingContent}
            sending={sending}
            polishHintAfterDictation={polishHintAfterDictation}
            llmActionsEnabled={llmActionsEnabled}
            onToolConfirm={onToolConfirm}
            onPolish={onPolish}
            replyModeControl={replyModeControl}
            onOptionSelect={onOptionSelect}
            liveNoteStream={liveNoteStream}
            onOpenNoteInEditor={onOpenNoteInEditor}
          />
          <div id="chat-live-edge" className="chat-live-edge" aria-hidden />
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
          onAttachmentError={onAttachmentError}
          focusComposerNonce={focusComposerNonce}
          inputRef={inputRef}
          placeholder={placeholder}
          modeControl={modeControl}
          onCycleMode={onCycleMode}
        />
      </div>
      <ChatSelectionImagePopover containerRef={chatPaneRef} />
    </div>
  );
}
