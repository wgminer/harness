import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Mic, Check, Loader2, X, FileAudio, ArrowUp, Plus } from "lucide-react";
import type { VoiceState } from "./chatHelpers";
import {
  AUDIO_FILE_ACCEPT,
  fileFromAudioPath,
  pickAudioAttachFile,
  pickAudioAttachPath,
} from "./audioAttach";
import { useTypedPlaceholder } from "./useTypedPlaceholder";
import { formatVoiceTimer } from "./useVoiceCapture";

interface ChatComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  voiceState: VoiceState;
  voiceError: string | null;
  recordingMs: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  attachedAudioName: string | null;
  attachmentTranscribing: boolean;
  attachmentError: string | null;
  onAttachAudio: (file: File | null) => void;
  onRemoveAttachedAudio: () => void;
  /** Shown when a drop/pick is not a usable audio file. */
  onAttachmentError?: (message: string | null) => void;
  focusComposerNonce?: number;
  inputRef?: MutableRefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  modeControl?: ReactNode;
  /** Shift+Tab in the composer cycles chat modes. */
  onCycleMode?: () => void;
}

export function ChatComposer({
  input,
  onInputChange,
  onSend,
  onStop,
  sending,
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
  inputRef: externalInputRef,
  placeholder = "Write a message…",
  modeControl,
  onCycleMode,
}: ChatComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null) as MutableRefObject<HTMLTextAreaElement | null>;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const attachDisabledRef = useRef(false);
  const [dropTargetActive, setDropTargetActive] = useState(false);
  const typedPlaceholder = useTypedPlaceholder(placeholder);

  const attachDisabled =
    voiceState !== "idle" || sending || attachmentTranscribing;
  attachDisabledRef.current = attachDisabled;

  // Auto-grow textarea to fit content (up to CSS max-height)
  const adjustInputHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustInputHeight();
  }, [input, adjustInputHeight]);

  useEffect(() => {
    if (focusComposerNonce == null || focusComposerNonce < 1) return;
    inputRef.current?.focus();
  }, [focusComposerNonce]);

  const clearDropTarget = useCallback(() => {
    dragDepthRef.current = 0;
    setDropTargetActive(false);
  }, []);

  const tryAttachAudioFiles = useCallback(
    (files: FileList | File[] | null | undefined) => {
      if (attachDisabledRef.current) return;
      const picked = pickAudioAttachFile(files);
      if (!picked) {
        if (files && files.length > 0) {
          onAttachmentError?.("Drop an audio file (m4a, mp3, wav, …).");
        }
        return;
      }
      onAttachmentError?.(null);
      onAttachAudio(picked);
    },
    [onAttachAudio, onAttachmentError],
  );

  const tryAttachAudioPaths = useCallback(
    async (paths: string[]) => {
      if (attachDisabledRef.current) return;
      const picked = pickAudioAttachPath(paths);
      if (!picked) {
        if (paths.length > 0) {
          onAttachmentError?.("Drop an audio file (m4a, mp3, wav, …).");
        }
        return;
      }
      try {
        const staged = await window.harness.recording.stageDroppedAudio(picked);
        const file = await fileFromAudioPath(staged.path, staged.name);
        onAttachmentError?.(null);
        onAttachAudio(file);
      } catch (err) {
        onAttachmentError?.(
          err instanceof Error ? err.message : "Unable to read dropped audio.",
        );
      }
    },
    [onAttachAudio, onAttachmentError],
  );

  // Tauri intercepts OS file drops; HTML5 drag events never fire in the webview.
  // Listen to the native drag-drop API and accept drops anywhere on the window.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        if (cancelled) return;
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            if (!attachDisabledRef.current) setDropTargetActive(true);
            return;
          }
          if (payload.type === "leave") {
            clearDropTarget();
            return;
          }
          if (payload.type === "drop") {
            clearDropTarget();
            void tryAttachAudioPaths(payload.paths);
          }
        });
      } catch {
        // Browser / Storybook — HTML5 handlers below cover file drops.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [clearDropTarget, tryAttachAudioPaths]);

  return (
    <>
      {voiceError && (
        <div className="voice-error">{voiceError}</div>
      )}
      {attachmentError && (
        <div className="voice-error">{attachmentError}</div>
      )}
      <div
        className={`chat-composer-inner${dropTargetActive ? " chat-composer-inner--drop-target" : ""}`}
        onKeyDown={(e) => {
          if (e.key === "Tab" && e.shiftKey && onCycleMode && !e.altKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (!sending) onCycleMode();
          }
        }}
        onDragEnter={(e) => {
          if (attachDisabled) return;
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          dragDepthRef.current += 1;
          setDropTargetActive(true);
        }}
        onDragOver={(e) => {
          if (attachDisabled) return;
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (attachDisabled) return;
          e.preventDefault();
          e.stopPropagation();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDropTargetActive(false);
        }}
        onDrop={(e) => {
          if (attachDisabled) return;
          e.preventDefault();
          e.stopPropagation();
          clearDropTarget();
          tryAttachAudioFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="chat-audio-file-input"
          accept={AUDIO_FILE_ACCEPT}
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            if (picked) tryAttachAudioFiles([picked]);
            else onAttachAudio(null);
            e.currentTarget.value = "";
          }}
        />
        {attachedAudioName && (
          <div className="chat-attachment-strip">
            <span className="chat-attachment-chip" title={attachedAudioName}>
              <FileAudio size={11} strokeWidth={1.75} />
              <span className="chat-attachment-name">{attachedAudioName}</span>
              <button
                type="button"
                className="chat-attachment-remove"
                onClick={onRemoveAttachedAudio}
                disabled={attachmentTranscribing}
                aria-label="Remove attached audio"
                title="Remove attached audio"
              >
                <X size={11} strokeWidth={1.75} />
              </button>
            </span>
            {attachmentTranscribing && (
              <span className="voice-status">
                <Loader2 size={13} className="voice-spinner" />
                Transcribing audio…
              </span>
            )}
          </div>
        )}
        <textarea
          ref={(el) => {
            inputRef.current = el;
            if (externalInputRef) externalInputRef.current = el;
          }}
          className="chat-input"
          data-testid="chat-input"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={typedPlaceholder}
          disabled={voiceState === "recording" || voiceState === "processing" || attachmentTranscribing}
          rows={1}
        />
        <div className="input-actions">
          {voiceState === "recording" && (
            <span className="voice-timer">
              {formatVoiceTimer(recordingMs)}
            </span>
          )}
          {voiceState === "processing" && (
            <span className="voice-status">
              <Loader2 size={13} className="voice-spinner" />
              Transcribing…
            </span>
          )}
          <div className="input-actions-spacer" />
          <button
            type="button"
            className="btn btn-icon chat-pane-btn chat-pane-btn--icon voice-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={attachDisabled}
            title="Attach audio file"
            aria-label="Attach audio file"
          >
            <Plus size={15} />
          </button>
          {voiceState !== "processing" && (
            <button
              type="button"
              className={`btn btn-icon chat-pane-btn chat-pane-btn--icon${voiceState === "recording" ? " btn-primary" : " voice-btn"}`}
              onClick={voiceState === "recording" ? onStopRecording : onStartRecording}
              disabled={sending}
              title={voiceState === "recording" ? "Stop recording" : "Record voice message"}
              aria-label={voiceState === "recording" ? "Stop recording" : "Start recording"}
            >
              {voiceState === "recording" ? <Check size={15} /> : <Mic size={15} />}
            </button>
          )}
          {voiceState !== "idle" && (
            <button
              type="button"
              className="btn btn-icon btn-danger chat-pane-btn chat-pane-btn--icon"
              onClick={onCancelRecording}
              title="Cancel recording"
              aria-label="Cancel recording"
            >
              <X size={15} />
            </button>
          )}
          {modeControl}
          {sending ? (
            <button type="button" className="btn chat-pane-btn input-actions-stop" onClick={onStop}>
              Stop
            </button>
          ) : voiceState === "idle" ? (
            <button
              type="button"
              className="btn btn-icon chat-pane-btn chat-pane-btn--icon"
              data-testid="chat-send"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onSend}
              disabled={(!input.trim() && !attachedAudioName) || attachmentTranscribing}
              title="Send message"
              aria-label="Send message"
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
