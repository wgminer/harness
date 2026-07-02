import { PARAKEET_MODEL_DOWNLOAD_LABEL } from "../shared/parakeetModel";
import type { ParakeetStatus } from "../shared/parakeetStatus";
import { SettingsActions, SettingsGroup, SettingsHint } from "./settings";
import { useParakeetModel } from "./useParakeetModel";

function statusLabel(status: ParakeetStatus, installed: boolean): string {
  if (installed || status.status === "ready") return "Ready";
  if (status.status === "downloading") return `Downloading… ${status.percent}%`;
  if (status.status === "checking") return "Preparing…";
  if (status.status === "error") return "Error";
  return "Not installed";
}

export function ParakeetModelSettingsGroup() {
  const { status, installed, download, cancel, remove } = useParakeetModel();

  const downloading = status.status === "downloading" || status.status === "checking";
  const error = status.status === "error" ? status.message : null;

  return (
    <SettingsGroup
      title="Local transcription model"
      description={`Parakeet runs on this Mac. ${PARAKEET_MODEL_DOWNLOAD_LABEL} one-time download from Hugging Face; stays in Application Support.`}
    >
      <dl className="usage-stats">
        <div className="usage-stats__row">
          <dt>Status</dt>
          <dd data-testid="parakeet-model-status">{statusLabel(status, installed)}</dd>
        </div>
      </dl>
      {error ? <SettingsHint>{error}</SettingsHint> : null}
      <SettingsActions>
        {!installed && !downloading ? (
          <button type="button" className="btn" data-testid="parakeet-download-button" onClick={() => void download()}>
            Download model
          </button>
        ) : null}
        {downloading ? (
          <button type="button" className="btn" onClick={() => void cancel()}>
            Cancel download
          </button>
        ) : null}
        {installed && !downloading ? (
          <button type="button" className="btn" data-testid="parakeet-remove-button" onClick={() => void remove()}>
            Remove model
          </button>
        ) : null}
        {status.status === "error" && !downloading ? (
          <button type="button" className="btn" onClick={() => void download()}>
            Retry
          </button>
        ) : null}
      </SettingsActions>
    </SettingsGroup>
  );
}
