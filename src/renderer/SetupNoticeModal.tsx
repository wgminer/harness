import { Modal } from "./Modal";
import type { SetupGap } from "../shared/setupState";
import { RIG_PAGE_TITLE } from "../shared/rigPage";

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
        A few things to set up in <strong>{RIG_PAGE_TITLE}</strong>. Voice dictation works right away
        on your Mac; chat and other AI features need an OpenAI API key.
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
                <button type="button" className="btn btn-chat-secondary" onClick={() => onConfigure(gap)}>
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
                <button type="button" className="btn btn-chat-secondary" onClick={() => onConfigure(gap)}>
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
