import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { getChatMode } from "../shared/chatModes";
import type { ConversationSessionKind } from "../shared/conversationSession";
import { formatMediumTimestamp } from "../shared/formatMediumTimestamp";
import type { RecordingLink } from "../shared/types";
import { Modal } from "./Modal";
import { Skeleton } from "./Skeleton";

interface ChatTitleModalProps {
  open: boolean;
  onClose: () => void;
  titleDraft: string;
  onTitleDraftChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  sessionKind?: ConversationSessionKind | null;
  hasAssistantReply?: boolean;
  createdAt?: number | null;
  chatMode?: string | null;
  messageCount?: number;
  recordings?: RecordingLink[];
  recordingsLoading?: boolean;
  onShowRecordingInFinder?: (path: string) => void;
}

function formatRecordingSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatRecordingLength(durationMs: number | null | undefined): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) return "—";
  const totalSec = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isDictationDetails(
  sessionKind: ConversationSessionKind | null | undefined,
  hasAssistantReply: boolean | undefined
): boolean {
  return sessionKind === "dictation" && !hasAssistantReply;
}

function RecordingTableSkeleton() {
  return (
    <div
      className="app-modal-recording-table"
      aria-busy="true"
      aria-label="Loading recordings"
      data-testid="chat-title-modal-recordings-skeleton"
    >
      <table>
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col">Size</th>
            <th scope="col">Length</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <div className="app-modal-recording-table__file">
                <Skeleton className="ui-skeleton--play" />
                <Skeleton className="ui-skeleton--name" />
              </div>
            </td>
            <td>
              <Skeleton className="ui-skeleton--num" />
            </td>
            <td>
              <Skeleton className="ui-skeleton--num" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function ChatTitleModal({
  open,
  onClose,
  titleDraft,
  onTitleDraftChange,
  onSave,
  saving,
  sessionKind = null,
  hasAssistantReply = false,
  createdAt = null,
  chatMode = null,
  messageCount,
  recordings = [],
  recordingsLoading = false,
  onShowRecordingInFinder,
}: ChatTitleModalProps) {
  const dictationDetails = isDictationDetails(sessionKind, hasAssistantReply);
  const modalTitle = dictationDetails ? "Dictation" : "Details";
  const typeLabel = sessionKind === "dictation" ? "Dictation" : "Conversation";
  const modeLabel = getChatMode(chatMode).label;
  // Only show for known dictations, or after a recording is confirmed — never while
  // a speculative load would mount then unmount the section (layout flicker).
  const showRecordingSection = sessionKind === "dictation" || recordings.length > 0;
  const createdLabel = createdAt != null ? formatMediumTimestamp(createdAt) : null;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingPath, setPlayingPath] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingPath(null);
  }, [open]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const togglePlayback = async (path: string) => {
    if (playingPath === path) {
      const current = audioRef.current;
      if (current) {
        current.pause();
        current.currentTime = 0;
      }
      audioRef.current = null;
      setPlayingPath(null);
      return;
    }

    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingPath(path);

    try {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const audio = new Audio(convertFileSrc(path));
      audioRef.current = audio;
      audio.onended = () => {
        setPlayingPath((current) => (current === path ? null : current));
        if (audioRef.current === audio) audioRef.current = null;
      };
      audio.onerror = () => {
        setPlayingPath((current) => (current === path ? null : current));
        if (audioRef.current === audio) audioRef.current = null;
      };
      await audio.play();
    } catch {
      setPlayingPath((current) => (current === path ? null : current));
      audioRef.current = null;
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={modalTitle}
      closeDisabled={saving}
      data-testid="chat-title-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving || !titleDraft.trim()}
          >
            Save
          </button>
        </>
      }
    >
      <div className="app-modal-stack">
        <label className="app-modal-field" htmlFor="chat-title-modal-input">
          <span className="app-modal-field__label">Title</span>
          <input
            id="chat-title-modal-input"
            type="text"
            className="app-modal-input"
            value={titleDraft}
            onChange={(e) => onTitleDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSave();
              }
            }}
            autoFocus
          />
        </label>

        <div className="app-modal-meta" data-testid="chat-title-modal-meta">
          {createdLabel ? (
            <div className="app-modal-meta__row">
              <span className="app-modal-meta__label">Created</span>
              <span className="app-modal-meta__value">{createdLabel}</span>
            </div>
          ) : null}
          <div className="app-modal-meta__row">
            <span className="app-modal-meta__label">Type</span>
            <span className="app-modal-meta__value">{typeLabel}</span>
          </div>
          {!dictationDetails ? (
            <div className="app-modal-meta__row">
              <span className="app-modal-meta__label">Mode</span>
              <span className="app-modal-meta__value">{modeLabel}</span>
            </div>
          ) : null}
          {messageCount != null ? (
            <div className="app-modal-meta__row">
              <span className="app-modal-meta__label">Messages</span>
              <span className="app-modal-meta__value">{messageCount.toLocaleString()}</span>
            </div>
          ) : null}
        </div>

        {showRecordingSection ? (
          <div className="app-modal-field" data-testid="chat-title-modal-recordings">
            <span className="app-modal-field__label">Recording</span>
            {recordingsLoading && recordings.length === 0 ? (
              <RecordingTableSkeleton />
            ) : recordings.length > 0 ? (
              <div className="app-modal-recording-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">File</th>
                      <th scope="col">Size</th>
                      <th scope="col">Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recordings.map((recording) => {
                      const isPlaying = playingPath === recording.path;
                      return (
                        <tr key={recording.path}>
                          <td>
                            <div className="app-modal-recording-table__file">
                              <button
                                type="button"
                                className="btn btn-icon-sm app-modal-recording-table__play"
                                disabled={!recording.exists || saving}
                                aria-label={isPlaying ? "Stop recording" : "Play recording"}
                                title={
                                  recording.exists
                                    ? isPlaying
                                      ? "Stop"
                                      : "Play"
                                    : "Recording file is missing"
                                }
                                onClick={() => {
                                  if (!recording.exists) return;
                                  void togglePlayback(recording.path);
                                }}
                              >
                                {isPlaying ? (
                                  <Square size={12} aria-hidden />
                                ) : (
                                  <Play size={12} aria-hidden />
                                )}
                              </button>
                              {recording.exists ? (
                                <button
                                  type="button"
                                  className="app-modal-recording-table__link"
                                  disabled={saving}
                                  title="Show in Finder"
                                  onClick={() => onShowRecordingInFinder?.(recording.path)}
                                >
                                  {recording.filename}
                                </button>
                              ) : (
                                <span
                                  className="app-modal-recording-table__missing"
                                  title="Recording file is missing"
                                >
                                  {recording.filename}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="app-modal-recording-table__num">
                            {formatRecordingSize(recording.byteSize)}
                          </td>
                          <td className="app-modal-recording-table__num">
                            {formatRecordingLength(recording.durationMs)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="app-modal-field__hint">No local recording on this device.</p>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
