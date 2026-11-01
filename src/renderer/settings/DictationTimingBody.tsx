import { useCallback, useEffect, useState } from "react";
import type { DictationTiming } from "../../shared/desktopAPI";
import { formatMediumTimestamp } from "../../shared/formatMediumTimestamp";
import { SettingsActions } from "./SettingsActions";
import { SettingsHint } from "./SettingsHint";
import { dictationTimeline, formatSeconds } from "./dictationTimeline";

function DictationTimingCard({ timing }: { timing: DictationTiming }) {
  const timeline = dictationTimeline(timing);
  const detail = [
    formatMediumTimestamp(timing.startedAt),
    timing.audioMs != null ? `${formatSeconds(timing.audioMs)} of audio` : null,
    timing.readyMs != null && timeline.spanMs > timing.readyMs
      ? `all steps done at ${formatSeconds(timeline.spanMs)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="settings-entry-row dictation-timing">
      <div className="settings-entry-row__body">
        <div className="settings-entry-row__title">
          {timing.readyMs != null ? `Ready in ${formatSeconds(timing.readyMs)}` : "Did not finish"}
        </div>
        <div className="settings-entry-row__detail">{detail}</div>
        <div className="dictation-timing__rows">
          {timeline.rows.map((row, i) => (
            <div key={i} className="dictation-timing__row">
              <div
                className="dictation-timing__label"
                title={row.step.detail}
              >
                <span>{row.step.name}</span>
                <span className="dictation-timing__duration">
                  {formatSeconds(row.step.durationMs)}
                  {row.step.outcome !== "ok" ? ` ${row.step.outcome}` : ""}
                </span>
              </div>
              <div className="dictation-timing__track">
                {timeline.readyPct != null ? (
                  <div
                    className="dictation-timing__ready"
                    style={{ left: `${timeline.readyPct}%` }}
                  />
                ) : null}
                <div
                  className="dictation-timing__bar"
                  data-outcome={row.step.outcome}
                  data-after-ready={row.afterReady || undefined}
                  style={{ left: `${row.leftPct}%`, width: `${row.widthPct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Step-by-step timing for the last few dictations; the body of a disclosure. */
export function DictationTimingBody() {
  const [timings, setTimings] = useState<DictationTiming[] | null>(null);

  const refresh = useCallback(() => {
    void window.harness.recording
      .listDictationTimings()
      .then(setTimings)
      .catch(() => setTimings([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <>
      <SettingsHint flush>
        The last five, newest first. Bars that overlap ran at the same time; the line marks when the
        text was ready.
      </SettingsHint>
      {timings && timings.length > 0 ? (
        <div className="settings-entry-list">
          {timings.map((t) => (
            <DictationTimingCard key={t.id} timing={t} />
          ))}
        </div>
      ) : timings ? (
        <SettingsHint flush>No dictations recorded yet.</SettingsHint>
      ) : null}
      <SettingsActions>
        <button type="button" className="btn btn-sm" onClick={refresh}>
          Refresh
        </button>
      </SettingsActions>
    </>
  );
}
