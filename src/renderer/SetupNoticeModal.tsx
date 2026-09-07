import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Modal } from "./Modal";
import { SecretField } from "./settings/SecretField";
import { useHexScrambleReveal } from "./useHexScrambleReveal";

const SETUP_NOTICE_TITLE = "Welcome to Harness";

interface SetupNoticeModalProps {
  open: boolean;
  onSaveApiKey: (apiKey: string) => void | Promise<void>;
  onDismiss: () => void;
}

function enterStyle(index: number): CSSProperties {
  return { "--setup-notice-enter-i": index } as CSSProperties;
}

function enterClass(revealed: boolean): string {
  return ["setup-notice-enter", revealed ? "setup-notice-enter--in" : null].filter(Boolean).join(" ");
}

export function SetupNoticeModal({ open, onSaveApiKey, onDismiss }: SetupNoticeModalProps) {
  const { display, settled } = useHexScrambleReveal(SETUP_NOTICE_TITLE, open);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setApiKey("");
      setSaving(false);
      setError(null);
    }
  }, [open]);

  const canContinue = apiKey.trim().length > 0 && !saving;

  const submit = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSaveApiKey(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save API key.");
      setSaving(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <Modal
      open={open}
      onClose={onDismiss}
      closeDisabled={saving || !settled}
      hideClose={!settled}
      title={
        <span className="setup-notice-title">
          <span
            className={settled ? "setup-notice-title__settled" : "chat-stream-wait-ticker"}
            aria-hidden="true"
          >
            {[...display].map((glyph, i) => (
              <span
                key={`${i}:${glyph}`}
                className={settled ? undefined : "chat-stream-wait-ticker__glyph"}
              >
                {glyph === " " ? "\u00a0" : glyph}
              </span>
            ))}
          </span>
        </span>
      }
      ariaLabel={SETUP_NOTICE_TITLE}
      data-testid="setup-notice-modal"
      footer={
        <>
          <button
            type="button"
            className={`btn ${enterClass(settled)}`}
            style={enterStyle(2)}
            onClick={onDismiss}
            disabled={saving}
            tabIndex={settled ? undefined : -1}
            aria-hidden={settled ? undefined : true}
          >
            Skip for now
          </button>
          <button
            type="submit"
            form="setup-notice-api-key-form"
            className={`btn btn-primary ${enterClass(settled)}`}
            style={enterStyle(2)}
            disabled={!canContinue}
            tabIndex={settled ? undefined : -1}
            aria-hidden={settled ? undefined : true}
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </>
      }
    >
      <form id="setup-notice-api-key-form" className="setup-notice-form" onSubmit={onSubmit}>
        <p className={`setup-notice-lead ${enterClass(settled)}`} style={enterStyle(0)}>
          Harness works locally on your Mac. Paste an OpenAI API key to start chatting — sync and
          other options stay in Settings.
        </p>
        <label
          className={`app-modal-field ${enterClass(settled)}`}
          style={enterStyle(1)}
          htmlFor="setup-notice-api-key"
        >
          <span className="app-modal-field__label">OpenAI API key</span>
          <div className="setup-notice-key">
            <SecretField
              id="setup-notice-api-key"
              testId="setup-notice-api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              ariaLabel="OpenAI API key"
            />
          </div>
        </label>
        {error ? (
          <p className="setup-notice-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
