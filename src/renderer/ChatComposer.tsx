import { useCallback, useEffect, useRef } from "react";
import { Mic, Square, Loader2, X } from "lucide-react";
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
  focusComposerNonce?: number;
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
  focusComposerNonce,
}: ChatComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
      <div className="chat-composer-inner">
        <textarea
          ref={inputRef}
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
          disabled={voiceState === "recording" || voiceState === "processing"}
          rows={1}
        />
        <div className="input-actions">
          <div className="voice-controls">
            {voiceState === "idle" && (
              <button
                type="button"
                className="btn btn-icon voice-btn"
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
                  className="btn btn-icon voice-btn voice-btn--recording"
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
              className="btn btn-cancel"
              onClick={onCancelRecording}
              title="Cancel recording"
            >
              <X size={15} />
              Cancel
            </button>
          ) : sending ? (
            <button type="button" className="btn input-actions-stop" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="chat-send"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onSend}
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </>
  );
}
