import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { DictationWave } from "./DictationWave";
import {
  cancelTake,
  landingKey,
  stopTake,
  useDictationTake,
  useTakeHasInlineChrome,
  type TakeLanding,
} from "./dictationTake";
import { formatVoiceTimer } from "./useVoiceCapture";

interface DictationPillProps {
  /** The surface on screen now; a take landing there shows in that surface's own chrome. */
  currentLanding: TakeLanding | null;
}

/**
 * Floating controls for a take whose own surface is not on screen: the user moved
 * to another view mid-take, or it is an Fn take with no composer to show it.
 * Never blocks the app underneath.
 */
export function DictationPill({ currentLanding }: DictationPillProps) {
  const take = useDictationTake();
  const inlineChrome = useTakeHasInlineChrome();
  const [elapsedMs, setElapsedMs] = useState(0);

  const shownInline =
    inlineChrome &&
    take?.landing != null &&
    currentLanding != null &&
    landingKey(take.landing) === landingKey(currentLanding);
  const visible = take != null && !shownInline;
  const recordingSince = visible && take.phase === "recording" ? take.startedAt : null;

  useEffect(() => {
    if (recordingSince == null) return;
    const tick = () => setElapsedMs(Date.now() - recordingSince);
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [recordingSince]);

  if (!visible) return null;
  const recording = take.phase === "recording";

  return (
    <div
      className="dictation-pill"
      data-testid="dictation-pill"
      data-phase={take.phase}
      role="status"
      aria-label={recording ? "Recording" : "Transcribing"}
    >
      {recording ? (
        <>
          <DictationWave className="dictation-pill__wave" />
          <span className="dictation-pill__timer">{formatVoiceTimer(elapsedMs)}</span>
        </>
      ) : (
        <span className="dictation-pill__status">
          <Loader2 size={13} className="voice-spinner" aria-hidden />
          Transcribing…
        </span>
      )}
      <button
        type="button"
        className="btn btn-icon voice-btn"
        data-testid="dictation-pill-cancel"
        onClick={() => void cancelTake()}
        title="Cancel recording"
        aria-label="Cancel recording"
      >
        <X size={15} />
      </button>
      {recording ? (
        <button
          type="button"
          className="btn btn-icon btn-primary"
          data-testid="dictation-pill-stop"
          onClick={() => void stopTake()}
          title="Stop recording"
          aria-label="Stop recording"
        >
          <Check size={15} />
        </button>
      ) : null}
    </div>
  );
}
