import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { RecentRecording } from "../../shared/desktopAPI";
import { formatMediumTimestamp } from "../../shared/formatMediumTimestamp";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";

const RECENT_RECORDINGS_LIMIT = 3;

function formatClipLength(ms: number | null): string {
  if (ms == null) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Last few saved takes, each re-runnable through the normal dictation pipeline. */
export function RecentRecordingsSection() {
  const [recordings, setRecordings] = useState<RecentRecording[] | null>(null);
  const [retryingPath, setRetryingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void window.harness.recording
      .listRecent(RECENT_RECORDINGS_LIMIT)
      .then(setRecordings)
      .catch(() => setRecordings([]));
  }, []);

  useEffect(() => {
    refresh();
    const unsubReady = window.harness.recording.onGlobalTranscriptReady(() => {
      setRetryingPath(null);
    });
    const unsubError = window.harness.recording.onGlobalRecordingError(({ message }) => {
      setRetryingPath(null);
      setError(message);
    });
    return () => {
      unsubReady();
      unsubError();
    };
  }, [refresh]);

  const retry = (path: string) => {
    setError(null);
    setRetryingPath(path);
    window.harness.recording.retryGlobalTranscription(path, { focused: true }).catch((err: unknown) => {
      setRetryingPath(null);
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <SettingsGroup
      title="Recent recordings"
      description="Audio is saved even when transcription fails. Retry sends a take through dictation again."
    >
      {recordings && recordings.length > 0 ? (
        <div className="settings-entry-list">
          {recordings.map((rec) => {
            const busy = retryingPath === rec.path;
            return (
              <div key={rec.path} className="settings-entry-row">
                <div className="settings-entry-row__body">
                  <div className="settings-entry-row__title">{formatMediumTimestamp(rec.recordedAt)}</div>
                  {rec.durationMs != null ? (
                    <div className="settings-entry-row__detail">{formatClipLength(rec.durationMs)}</div>
                  ) : null}
                </div>
                <div className="settings-entry-row__actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => retry(rec.path)}
                    disabled={retryingPath != null}
                    aria-busy={busy}
                  >
                    {busy ? (
                      <Loader2 size={14} className="voice-spinner" aria-hidden />
                    ) : (
                      <RotateCcw size={14} aria-hidden />
                    )}
                    {busy ? "Transcribing…" : "Retry"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : recordings ? (
        <SettingsHint flush>No saved recordings yet.</SettingsHint>
      ) : null}
      {error ? <p className="settings-import-status__errors">{error}</p> : null}
    </SettingsGroup>
  );
}
