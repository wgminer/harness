import { useEffect } from "react";
import { Modal } from "./Modal";
import { PARAKEET_MODEL_DOWNLOAD_LABEL } from "../shared/parakeetModel";
import { useParakeetModel } from "./useParakeetModel";

interface ParakeetDownloadModalProps {
  open: boolean;
  onClose: () => void;
  onReady?: () => void;
}

export function ParakeetDownloadModal({ open, onClose, onReady }: ParakeetDownloadModalProps) {
  const { status, installed, download, cancel } = useParakeetModel();

  const downloading = status.status === "downloading" || status.status === "checking";
  const error = status.status === "error" ? status.message : null;

  useEffect(() => {
    if (open && installed) {
      onReady?.();
      onClose();
    }
  }, [open, installed, onClose, onReady]);

  return (
    <Modal
      open={open}
      onClose={downloading ? () => {} : onClose}
      title="Download voice model"
      data-testid="parakeet-download-modal"
      footer={
        <>
          {downloading ? (
            <button type="button" className="btn" onClick={() => void cancel()}>
              Cancel
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose}>
                Not now
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="parakeet-download-confirm"
                onClick={() => void download().then(() => onReady?.())}
              >
                Download
              </button>
            </>
          )}
        </>
      }
    >
      <p>
        Voice dictation needs a one-time {PARAKEET_MODEL_DOWNLOAD_LABEL} download from Hugging Face.
        The model stays on this Mac in Application Support.
      </p>
      {downloading && status.status === "downloading" ? (
        <p className="settings-hint" data-testid="parakeet-download-progress">
          Downloading… {status.percent}%
        </p>
      ) : null}
      {status.status === "checking" ? (
        <p className="settings-hint">Preparing download…</p>
      ) : null}
      {error ? <p className="settings-hint settings-hint--error">{error}</p> : null}
    </Modal>
  );
}
