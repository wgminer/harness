import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { Mic, Check, Loader2, X, Paperclip, ArrowUp } from "lucide-react";
import type { VoiceState } from "./chatHelpers";

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
  focusComposerNonce?: number;
  inputRef?: MutableRefObject<HTMLTextAreaElement | null>;
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
  focusComposerNonce,
  inputRef: externalInputRef,
}: ChatComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null) as MutableRefObject<HTMLTextAreaElement | null>;
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <>
      {voiceError && (
        <div className="voice-error">{voiceError}</div>
      )}
      {attachmentError && (
        <div className="voice-error">{attachmentError}</div>
      )}
      <div className="chat-composer-inner">
        <input
          ref={fileInputRef}
          type="file"
          className="chat-audio-file-input"
          accept="audio/*,.m4a,.mp4,.mpeg4,.aac,.mp3,.wav,.caf,.aif,.aiff"
          onChange={(e) => {
            const picked = e.target.files?.[0] ?? null;
            onAttachAudio(picked);
            e.currentTarget.value = "";
          }}
        />
        {attachedAudioName && (
          <div className="chat-attachment-strip">
            <span className="chat-attachment-chip" title={attachedAudioName}>
              <Paperclip size={12} />
              <span className="chat-attachment-name">{attachedAudioName}</span>
              <button
                type="button"
                className="chat-attachment-remove"
                onClick={onRemoveAttachedAudio}
                disabled={attachmentTranscribing}
                aria-label="Remove attached audio"
                title="Remove attached audio"
              >
                <X size={12} />
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
          placeholder="Type a message..."
          disabled={voiceState === "recording" || voiceState === "processing" || attachmentTranscribing}
          rows={1}
        />
        <div className="input-actions">
          {voiceState === "recording" && (
            <span className="voice-timer">
              {`${Math.floor(recordingMs / 60000)}:${String(Math.floor((recordingMs % 60000) / 1000)).padStart(2, "0")}.${String(recordingMs % 1000).padStart(3, "0")}`}
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
            disabled={voiceState !== "idle" || sending || attachmentTranscribing}
            title="Attach audio file"
            aria-label="Attach audio file"
          >
            <Paperclip size={15} />
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
              className="btn btn-icon chat-pane-btn chat-pane-btn--icon chat-pane-btn--danger"
              onClick={onCancelRecording}
              title="Cancel recording"
              aria-label="Cancel recording"
            >
              <X size={15} />
            </button>
          )}
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
