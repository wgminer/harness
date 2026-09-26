import { useEffect, useState } from "react";
import {
  homeHeaderQuoteAttribution,
  homeHeaderQuoteNote,
  nextHomeHeaderQuote,
  type HomeHeaderQuote,
} from "../../shared/headerQuote";
import { formatDictateDurationLabel } from "../../shared/dictateDurationLabel";

/** Mounts only on empty compose — draws once per visit from the shuffle bag. */
export function ComposeHeaderQuote() {
  const [quote] = useState<HomeHeaderQuote>(() => nextHomeHeaderQuote());
  const attribution = homeHeaderQuoteAttribution(quote);
  const note = homeHeaderQuoteNote(quote);
  return (
    <span className="tooltip new-chat-quote-tooltip">
      <p className="new-chat-quote">{`“${quote.full}”`}</p>
      <span className="tooltip__label">
        {attribution ? <span className="new-chat-quote-tooltip__attr">{attribution}</span> : null}
        {note ? <span>{note}</span> : null}
      </span>
    </span>
  );
}

function formatComposeClock(now: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
}

function formatComposeDate(now: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(now);
}

/** Quiet ambient facts in the four corners of the compose splash. */
export function ComposeCornerMeta() {
  const [now, setNow] = useState(() => new Date());
  const [durationLabel, setDurationLabel] = useState(() => formatDictateDurationLabel(0));
  const [weatherLabel, setWeatherLabel] = useState("—");

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshMeta = async () => {
      try {
        const stats = await window.harness.recording.archiveStats();
        if (!cancelled) {
          setDurationLabel(formatDictateDurationLabel(stats?.durationMs ?? 0));
        }
      } catch {
        // Keep last known label if IPC is unavailable.
      }
      try {
        const weather = await window.harness.weather.getCurrent();
        if (!cancelled) {
          setWeatherLabel(
            typeof weather?.label === "string" && weather.label.trim().length > 0
              ? weather.label
              : "—",
          );
        }
      } catch {
        if (!cancelled) setWeatherLabel("—");
      }
    };

    void refreshMeta();
    const onFocus = () => {
      void refreshMeta();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <>
      <p className="new-chat-corner new-chat-corner--top-left" aria-hidden="true">
        {formatComposeClock(now)}
      </p>
      <p className="new-chat-corner new-chat-corner--top-right" aria-hidden="true">
        {formatComposeDate(now)}
      </p>
      <p className="new-chat-corner new-chat-corner--bottom-left" aria-hidden="true">
        {durationLabel}
      </p>
      <p className="new-chat-corner new-chat-corner--bottom-right" aria-hidden="true">
        {weatherLabel}
      </p>
    </>
  );
}
