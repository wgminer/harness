import { Modal } from "./Modal";
import type { SetupGap } from "../shared/setupState";

interface SetupNoticeModalProps {
  open: boolean;
  gaps: SetupGap[];
  onConfigure: (gap: SetupGap) => void;
  onDismiss: () => void;
}

export function SetupNoticeModal({ open, gaps, onConfigure, onDismiss }: SetupNoticeModalProps) {
  const required = gaps.filter((g) => g.severity === "required");
  const recommended = gaps.filter((g) => g.severity === "recommended");

  return (
    <Modal
      open={open}
      onClose={onDismiss}
      title="Welcome to Harness"
      data-testid="setup-notice-modal"
      footer={
        <button type="button" className="btn" onClick={onDismiss}>
          Got it
        </button>
      }
    >
      <p className="setup-notice-lead">
        Harness works locally on your Mac. Chat needs an OpenAI API key; voice dictation needs a
        one-time model download in Settings → Voice. Cloud sync is optional — set up R2 when you
        want to pull data from another device.
      </p>
      {required.length > 0 && (
        <section className="setup-notice-section">
          <h4 className="setup-notice-heading">Required for chat</h4>
          <ul className="setup-notice-list">
            {required.map((gap) => (
              <li key={gap.kind} className="setup-notice-item">
                <div className="setup-notice-item__body">
                  <strong>{gap.title}</strong>
                  <p>{gap.detail}</p>
                </div>
                <button type="button" className="btn btn-compact" onClick={() => onConfigure(gap)}>
                  Set up
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {recommended.length > 0 && (
        <section className="setup-notice-section">
          <h4 className="setup-notice-heading">Recommended</h4>
          <ul className="setup-notice-list">
            {recommended.map((gap) => (
              <li key={gap.kind} className="setup-notice-item">
                <div className="setup-notice-item__body">
                  <strong>{gap.title}</strong>
                  <p>{gap.detail}</p>
                </div>
                <button type="button" className="btn btn-compact" onClick={() => onConfigure(gap)}>
                  Set up
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  );
}
