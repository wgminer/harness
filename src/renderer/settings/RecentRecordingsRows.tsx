import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { RecentRecording } from "../../shared/desktopAPI";
import { formatMediumTimestamp } from "../../shared/formatMediumTimestamp";
import { SettingsPanelBlock, SettingsRow } from "./SettingsPanel";

const RECENT_RECORDINGS_LIMIT = 3;

function formatClipLength(ms: number | null): string {
  if (ms == null) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Last few saved takes as panel rows, each re-runnable through the normal dictation pipeline. */
export function RecentRecordingsRows() {
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

  if (!recordings) return null;
  return (
    <>
      {recordings.length === 0 ? (
        <SettingsRow label="No saved recordings yet" description="Takes show up here after you dictate." />
      ) : (
        recordings.map((rec) => {
          const busy = retryingPath === rec.path;
          return (
            <SettingsRow
              key={rec.path}
              label={formatMediumTimestamp(rec.recordedAt)}
              description={rec.durationMs != null ? formatClipLength(rec.durationMs) : undefined}
            >
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
            </SettingsRow>
          );
        })
      )}
      {error ? (
        <SettingsPanelBlock>
          <p className="settings-inline-error">{error}</p>
        </SettingsPanelBlock>
      ) : null}
    </>
  );
}
