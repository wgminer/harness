import { useLayoutEffect, useRef } from "react";
import type { MutableRefObject, ReactNode, RefObject } from "react";
import type { CodingScopeMeta } from "../shared/desktopAPI";
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
  onOpenConversation?: (conversationId: string) => void;
  onOpenImage?: (imageId: string) => void;
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
  codingScope?: CodingScopeMeta | null;
  selfScopeAvailable?: boolean;
  onPickProjectFolder?: () => Promise<void> | void;
  onUseSelfScope?: () => Promise<void> | void;
  onClearCodingScope?: () => Promise<void> | void;
  /** Hide the dock while dictation reply actions (Run / vocab) own the continue path. */
  hideComposer?: boolean;
}

export function ChatSurface({
  chatAreaRef,
  composerRef,
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
  onOpenConversation,
  onOpenImage,
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
  codingScope = null,
  selfScopeAvailable = false,
  onPickProjectFolder,
  onUseSelfScope,
  onClearCodingScope,
  hideComposer = false,
}: ChatSurfaceProps) {
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const centerSingleMessage =
    displayMessages.length === 1 && !sending && !streamingContent;
  const showDictationActions =
    hideComposer && (polishHintAfterDictation || !!replyModeControl);

  const { onScroll, onKeyDown } = useChatScrollController({
    scrollRef: chatAreaRef,
    chatPaneRef,
    composerDockRef: composerRef,
    scrollEnabled: !centerSingleMessage,
    sending,
  });

  useLayoutEffect(() => {
    if (hideComposer) return;
    if (focusComposerNonce == null || focusComposerNonce < 1) return;
    composerRef.current?.querySelector<HTMLTextAreaElement>(".chat-input")?.focus();
  }, [composerRef, focusComposerNonce, hideComposer]);

  /*
   * `.chat-pane` is `position: relative`. `.chat-scroll` fills it and scrolls; bottom inset
   * padding matches the overlay `.chat-composer-dock` via `--chat-composer-dock-height`.
   * Keep an empty dock shell when hidden so ResizeObserver can collapse the inset to 0.
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
            onOpenConversation={onOpenConversation}
            onOpenImage={onOpenImage}
            dockSecondaryActions={hideComposer}
          />
          <div id="chat-live-edge" className="chat-live-edge" aria-hidden />
        </div>
      </div>
      {showDictationActions ? (
        <div
          className="chat-dictation-actions"
          data-testid="chat-secondary-actions"
        >
          {polishHintAfterDictation ? (
            <button
              type="button"
              className="btn btn-compact chat-pane-btn"
              onClick={onPolish}
              disabled={!llmActionsEnabled}
            >
              Polish
            </button>
          ) : null}
          {replyModeControl}
        </div>
      ) : null}
      <div
        ref={composerRef}
        className={
          hideComposer ? "chat-composer-dock chat-composer-dock--hidden" : "chat-composer-dock"
        }
        data-testid={composerTestId}
        role="group"
        aria-label="Message composer"
        aria-hidden={hideComposer || undefined}
      >
        {hideComposer ? null : (
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
            codingScope={codingScope}
            selfScopeAvailable={selfScopeAvailable}
            onPickProjectFolder={onPickProjectFolder}
            onUseSelfScope={onUseSelfScope}
            onClearCodingScope={onClearCodingScope}
          />
        )}
      </div>
      <ChatSelectionImagePopover containerRef={chatPaneRef} />
    </div>
  );
}
