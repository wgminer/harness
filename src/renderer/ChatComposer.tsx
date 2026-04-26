import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { Mic, Square, Loader2, X, Paperclip } from "lucide-react";
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
          <div className="voice-controls">
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
            {voiceState === "idle" && (
              <button
                type="button"
                className="btn btn-icon chat-pane-btn chat-pane-btn--icon voice-btn"
                onClick={onStartRecording}
                disabled={sending}
                title="Record voice message"
                aria-label="Start recording"
              >
                <Mic size={15} />
              </button>
            )}
            {voiceState === "recording" && (
              <>
                <button
                  type="button"
                  className="btn btn-icon chat-pane-btn chat-pane-btn--icon voice-btn voice-btn--recording"
                  onClick={onStopRecording}
                  title="Stop recording"
                  aria-label="Stop recording"
                >
                  <Square size={13} />
                </button>
                <span className="voice-timer">
                  {`${Math.floor(recordingMs / 60000)}:${String(Math.floor((recordingMs % 60000) / 1000)).padStart(2, "0")}.${String(recordingMs % 1000).padStart(3, "0")}`}
                </span>
              </>
            )}
            {voiceState === "processing" && (
              <span className="voice-status">
                <Loader2 size={13} className="voice-spinner" />
                Transcribing…
              </span>
            )}
          </div>
          {voiceState !== "idle" ? (
            <button
              type="button"
              className="btn chat-pane-btn chat-pane-btn--danger"
              onClick={onCancelRecording}
              title="Cancel recording"
            >
              <X size={15} />
              Cancel
            </button>
          ) : sending ? (
            <button type="button" className="btn chat-pane-btn input-actions-stop" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn chat-pane-btn"
              data-testid="chat-send"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onSend}
              disabled={(!input.trim() && !attachedAudioName) || attachmentTranscribing}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </>
  );
}
