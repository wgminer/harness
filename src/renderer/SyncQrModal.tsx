import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Modal } from "./Modal";
import {
  decodePairingPayload,
  encodePairingPayload,
  pairingSecondsRemaining,
  type PairingPayloadV1,
} from "../shared/pairingPayload";

export interface SyncQrModalProps {
  open: boolean;
  onClose: () => void;
  accountId: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  openaiApiKey: string;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SyncQrModal({
  open,
  onClose,
  accountId,
  bucket,
  prefix,
  accessKeyId,
  secretAccessKey,
  openaiApiKey,
}: SyncQrModalProps) {
  const [encoded, setEncoded] = useState<string | null>(null);
  const [payload, setPayload] = useState<Pick<PairingPayloadV1, "exp"> | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [copied, setCopied] = useState(false);

  const rebuild = useCallback(async () => {
    setError(null);
    setCopied(false);
    try {
      const code = encodePairingPayload({
        accountId,
        bucket,
        prefix,
        accessKeyId,
        secretAccessKey,
        openaiApiKey,
      });
      const parsed = decodePairingPayload(code);
      const url = await QRCode.toDataURL(code, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 280,
        color: { dark: "#0a0a0a", light: "#ffffff" },
      });
      setEncoded(code);
      setPayload({ exp: parsed.exp });
      setDataUrl(url);
      setRemaining(pairingSecondsRemaining(parsed));
    } catch (e) {
      setEncoded(null);
      setPayload(null);
      setDataUrl(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [accountId, bucket, prefix, accessKeyId, secretAccessKey, openaiApiKey]);

  useEffect(() => {
    if (!open) {
      setEncoded(null);
      setPayload(null);
      setDataUrl(null);
      setError(null);
      return;
    }
    void rebuild();
  }, [open, rebuild]);

  useEffect(() => {
    if (!open || !payload) return;
    const tick = () => {
      const left = pairingSecondsRemaining(payload);
      setRemaining(left);
      if (left <= 0) onClose();
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open, payload, onClose]);

  const copyCode = async () => {
    if (!encoded) return;
    try {
      await navigator.clipboard.writeText(encoded);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Show sync QR"
      data-testid="sync-qr-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={() => void copyCode()} disabled={!encoded}>
            {copied ? "Copied" : "Copy sync code"}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className="settings-group__lead">
        Scan with the iPhone <strong>Set up sync</strong> flow. Contains your sync credentials —
        don’t screenshot or share. Expires in {formatCountdown(remaining)}.
      </p>
      {error ? (
        <p className="settings-import-status__errors" role="alert">
          {error.includes("Missing")
            ? "Fill in R2 account, bucket, access key, and secret access key first."
            : error}
        </p>
      ) : null}
      {dataUrl ? (
        <div
          className="sync-qr-modal__code"
          style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}
        >
          <img src={dataUrl} alt="Sync pairing QR code" width={280} height={280} />
        </div>
      ) : null}
    </Modal>
  );
}
