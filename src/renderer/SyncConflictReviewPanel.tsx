import { useCallback, useEffect, useMemo, useState } from "react";
import type { SyncConflictReview, SyncFileChoice } from "../shared/sync";
import { buildDefaultMergeChoices } from "../shared/sync";
import { SettingsActions } from "./settings/SettingsActions";
import { SettingsHint } from "./settings/SettingsHint";

const KIND_ORDER: Record<SyncConflictReview["files"][number]["kind"], number> = {
  conflict: 0,
  "local-only": 1,
  "remote-only": 2,
  unchanged: 3,
};

function kindLabel(kind: SyncConflictReview["files"][number]["kind"]): string {
  switch (kind) {
    case "local-only":
      return "Only on this device";
    case "remote-only":
      return "Only in backup";
    case "conflict":
      return "Changed on both";
    default:
      return "Unchanged";
  }
}

function choiceLabel(choice: SyncFileChoice, supportsMerge: boolean): string {
  if (choice === "merge" && supportsMerge) return "Merge both";
  if (choice === "local") return "This device";
  return "Backup";
}

function mismatchSlice(localText: string | undefined, remoteText: string | undefined): {
  local: string;
  remote: string;
} | null {
  if (!localText || !remoteText || localText === remoteText) return null;

  const maxPrefix = Math.min(localText.length, remoteText.length);
  let diffIndex = 0;
  while (diffIndex < maxPrefix && localText[diffIndex] === remoteText[diffIndex]) {
    diffIndex += 1;
  }

  const start = Math.max(0, diffIndex - 20);
  const localEnd = Math.min(localText.length, diffIndex + 40);
  const remoteEnd = Math.min(remoteText.length, diffIndex + 40);
  const localNeedsPrefix = start > 0;
  const remoteNeedsPrefix = start > 0;
  const localNeedsSuffix = localEnd < localText.length;
  const remoteNeedsSuffix = remoteEnd < remoteText.length;

  return {
    local: `${localNeedsPrefix ? "…" : ""}${localText.slice(start, localEnd)}${localNeedsSuffix ? "…" : ""}`,
    remote: `${remoteNeedsPrefix ? "…" : ""}${remoteText.slice(start, remoteEnd)}${remoteNeedsSuffix ? "…" : ""}`,
  };
}

interface SyncConflictReviewPanelProps {
  busy: boolean;
  onApplyMerge: (choices: Record<string, SyncFileChoice>) => Promise<void>;
  onCancel: () => void;
}

export function SyncConflictReviewPanel({
  busy,
  onApplyMerge,
  onCancel,
}: SyncConflictReviewPanelProps) {
  const [review, setReview] = useState<SyncConflictReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, SyncFileChoice>>({});
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electron.sync.getConflictReview().then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setLoadError(result.error);
        setReview(null);
        return;
      }
      setLoadError(null);
      setReview(result);
      setChoices(buildDefaultMergeChoices(result));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const changedFiles = useMemo(() => {
    const files = review?.files.filter((file) => file.kind !== "unchanged") ?? [];
    return files
      .slice()
      .sort(
        (a, b) =>
          KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.path.localeCompare(b.path),
      );
  }, [review]);

  const setChoice = useCallback((path: string, choice: SyncFileChoice) => {
    setChoices((prev) => ({ ...prev, [path]: choice }));
  }, []);

  const resetDefaults = useCallback(() => {
    if (!review) return;
    setChoices(buildDefaultMergeChoices(review));
  }, [review]);

  if (loadError) {
    return <SettingsHint flush>{loadError}</SettingsHint>;
  }

  if (!review) {
    return <SettingsHint flush>Loading changes…</SettingsHint>;
  }

  return (
    <div className="settings-sync-review">
      <p className="settings-sync-review__summary">
        {review.summary.localOnly} only here · {review.summary.remoteOnly} only in backup ·{" "}
        {review.summary.conflict} changed on both
      </p>

      <ul className="settings-sync-review__list">
        {changedFiles.map((file) => {
          const choice = choices[file.path] ?? file.defaultChoice;
          const expanded = expandedPath === file.path;
          return (
            <li key={file.path} className="settings-sync-review__item">
              <div className="settings-sync-review__row">
                <div className="settings-sync-review__meta">
                  <strong>{file.label}</strong>
                  <span className="settings-sync-review__path">{file.path}</span>
                  <span className="settings-sync-review__where-label">Conflict location</span>
                  <span
                    className={`settings-sync-review__kind settings-sync-review__kind--${file.kind}`}
                  >
                    {kindLabel(file.kind)}
                  </span>
                </div>
                <div className="settings-sync-review__choices">
                  {(["local", "remote", "merge"] as const)
                    .filter((option) => option !== "merge" || file.supportsMerge)
                    .map((option) => (
                      <label key={option} className="settings-sync-review__choice">
                        <input
                          type="radio"
                          name={`sync-choice-${file.path}`}
                          checked={choice === option}
                          disabled={busy}
                          onChange={() => setChoice(file.path, option)}
                        />
                        {choiceLabel(option, file.supportsMerge)}
                      </label>
                    ))}
                  {(file.localPreview || file.remotePreview) && (
                    <button
                      type="button"
                      className="settings-sync-review__preview-toggle"
                      onClick={() => setExpandedPath(expanded ? null : file.path)}
                    >
                      {expanded ? "Hide" : "Preview"}
                    </button>
                  )}
                </div>
              </div>
              {expanded && (
                <div className="settings-sync-review__preview">
                  {file.localPreview ? (
                    <p>
                      <strong>This device:</strong> {file.localPreview}
                    </p>
                  ) : (
                    <p>
                      <strong>This device:</strong> <em>(missing)</em>
                    </p>
                  )}
                  {file.remotePreview ? (
                    <p>
                      <strong>Backup:</strong> {file.remotePreview}
                    </p>
                  ) : (
                    <p>
                      <strong>Backup:</strong> <em>(missing)</em>
                    </p>
                  )}
                  {(() => {
                    const mismatch = mismatchSlice(file.localPreview, file.remotePreview);
                    if (!mismatch) return null;
                    return (
                      <p className="settings-sync-review__mismatch">
                        <strong>Mismatch:</strong>
                        <span>
                          {" "}
                          <code>This device: {mismatch.local}</code> vs{" "}
                          <code>Backup: {mismatch.remote}</code>
                        </span>
                      </p>
                    );
                  })()}
                  {(file.kind === "local-only" || file.kind === "remote-only") && (
                    <p className="settings-sync-review__mismatch">
                      <strong>Mismatch:</strong>{" "}
                      {file.kind === "local-only"
                        ? "file is missing from backup"
                        : "file is missing from this device"}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <SettingsActions>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || changedFiles.length === 0}
          onClick={() => void onApplyMerge(choices)}
        >
          {busy ? "Applying…" : "Apply merge"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={resetDefaults}>
          Reset to defaults
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </SettingsActions>
      <SettingsHint flush>
        Merge combines both sides where possible (conversations, tasks, notes, and similar).
        A snapshot of this device is saved under <code>local-data/sync/backups/</code> first,
        then the merged result is pushed to the backup folder.
      </SettingsHint>
    </div>
  );
}
