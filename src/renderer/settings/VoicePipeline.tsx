export interface VoicePipelineStep {
  /** Section anchor the step jumps to. */
  targetId: string;
  label: string;
  value: string;
  off?: boolean;
}

/** What happens between speaking and seeing text, one step per Voice section below. */
export function VoicePipeline({ steps }: { steps: VoicePipelineStep[] }) {
  const jump = (targetId: string) => {
    document.getElementById(targetId)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <nav className="settings-pipeline" aria-label="How dictation works" data-testid="settings-voice-pipeline">
      {steps.map((step) => (
        <button
          key={step.targetId}
          type="button"
          className="settings-pipeline__step"
          onClick={() => jump(step.targetId)}
        >
          <span className="settings-pipeline__track" aria-hidden>
            <span className={`settings-pipeline__node${step.off ? " settings-pipeline__node--off" : ""}`} />
            <span className="settings-pipeline__line" />
          </span>
          <span className="settings-pipeline__label">{step.label}</span>
          <span className="settings-pipeline__value">{step.value}</span>
        </button>
      ))}
    </nav>
  );
}
