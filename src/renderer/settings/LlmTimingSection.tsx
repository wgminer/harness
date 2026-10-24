import { useCallback, useEffect, useState } from "react";
import type { LlmTiming } from "../../shared/desktopAPI";
import { formatMediumTimestamp } from "../../shared/formatMediumTimestamp";
import { SettingsActions } from "./SettingsActions";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";
import { formatSeconds, llmTimingKindLabel, summarizeChatTimings } from "./llmTimingSummary";

const LLM_TIMING_LIMIT = 50;

function timingDetail(t: LlmTiming): string {
  return [
    formatMediumTimestamp(t.startedAt),
    t.firstTokenMs != null ? `first token ${formatSeconds(t.firstTokenMs)}` : null,
    t.round != null && t.round > 1 ? `round ${t.round}` : null,
    t.model,
    t.outcome !== "ok" ? t.outcome : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Recent OpenAI request durations, for checking whether replies are slow. */
export function LlmTimingSection() {
  const [timings, setTimings] = useState<LlmTiming[] | null>(null);

  const refresh = useCallback(() => {
    void window.harness.llmTiming
      .list(LLM_TIMING_LIMIT)
      .then(setTimings)
      .catch(() => setTimings([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clear = () => {
    void window.harness.llmTiming.clear().then(refresh);
  };

  const summary = timings ? summarizeChatTimings(timings) : null;

  return (
    <SettingsGroup
      title="Request timing"
      description="How long recent OpenAI requests took. Each chat round is one model call; tool calls add rounds."
      collapsible
      defaultOpen={false}
    >
      {summary ? <SettingsHint flush>{summary}</SettingsHint> : null}
      {timings && timings.length > 0 ? (
        <div className="settings-entry-list">
          {timings.map((t) => (
            <div key={`${t.startedAt}-${t.kind}-${t.round ?? 0}`} className="settings-entry-row">
              <div className="settings-entry-row__body">
                <div className="settings-entry-row__title">
                  {llmTimingKindLabel(t.kind)} · {formatSeconds(t.totalMs)}
                </div>
                <div className="settings-entry-row__detail">{timingDetail(t)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : timings ? (
        <SettingsHint flush>No requests recorded yet.</SettingsHint>
      ) : null}
      <SettingsActions>
        <button type="button" className="btn" onClick={refresh}>
          Refresh
        </button>
        {timings && timings.length > 0 ? (
          <button type="button" className="btn" onClick={clear}>
            Clear
          </button>
        ) : null}
      </SettingsActions>
    </SettingsGroup>
  );
}
