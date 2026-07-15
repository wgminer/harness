import { useCallback, useEffect, useState } from "react";
import { Modal } from "./Modal";
import type { ContextPreview, RecordingLink } from "../shared/types";

interface ContextInspectorModalProps {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
}

export function ContextInspectorModal({
  open,
  onClose,
  conversationId,
}: ContextInspectorModalProps) {
  const [preview, setPreview] = useState<ContextPreview | null>(null);
  const [recordings, setRecordings] = useState<RecordingLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setRecordings([]);
      setError(null);
      setCopied(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [contextPreview, recordingResult] = await Promise.all([
          window.harness.chat.getContextPreview(conversationId),
          conversationId
            ? window.harness.memory.getConversationRecordings(conversationId)
            : Promise.resolve({ recordings: [] as RecordingLink[] }),
        ]);
        if (cancelled) return;
        setPreview(contextPreview);
        setRecordings(recordingResult.recordings);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load context.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  const copySystemPrompt = useCallback(async () => {
    if (!preview?.systemPrompt) return;
    try {
      await navigator.clipboard.writeText(preview.systemPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable.
    }
  }, [preview?.systemPrompt]);

  const showRecordingInFinder = useCallback((path: string) => {
    void window.harness.recording.showInFolder(path);
  }, []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Context inspector"
      variant="scrollable"
      size="lg"
      data-testid="context-inspector-modal"
      footer={
        preview ? (
          <button type="button" className="btn" onClick={() => void copySystemPrompt()}>
            {copied ? "Copied" : "Copy system prompt"}
          </button>
        ) : null
      }
    >
      {loading ? <p className="context-inspector-status">Loading context…</p> : null}
      {error ? <p className="context-inspector-error">{error}</p> : null}
      {preview ? (
        <div className="context-inspector-sections">
          <section className="context-inspector-section">
            <h4 className="context-inspector-heading">Memory facts</h4>
            {preview.selectedFacts.length > 0 ? (
              <div className="context-inspector-facts">
                {preview.selectedFacts.map((fact) => (
                  <pre key={fact.key} className="context-inspector-pre">
                    <span className="context-inspector-fact-key">{fact.key}: </span>
                    {fact.value}
                  </pre>
                ))}
              </div>
            ) : (
              <p className="context-inspector-empty">No memory facts injected.</p>
            )}
          </section>

          <section className="context-inspector-section">
            <h4 className="context-inspector-heading">Temporal context</h4>
            <pre className="context-inspector-pre">{preview.temporalContext}</pre>
          </section>

          <section className="context-inspector-section">
            <h4 className="context-inspector-heading">System prompt</h4>
            <pre
              className="context-inspector-pre context-inspector-pre--tall"
              aria-label="System prompt"
            >
              {preview.systemPrompt}
            </pre>
          </section>

          <section className="context-inspector-section">
            <h4 className="context-inspector-heading">Messages sent to model</h4>
            {preview.messages.length > 0 ? (
              <div className="context-inspector-messages">
                {preview.messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className="context-inspector-message">
                    <div className="context-inspector-message-role">{message.role}</div>
                    <pre className="context-inspector-pre">{message.content}</pre>
                  </div>
                ))}
              </div>
            ) : (
              <p className="context-inspector-empty">No conversation history yet.</p>
            )}
          </section>

          <section className="context-inspector-section">
            <h4 className="context-inspector-heading">Available Tools</h4>
            <ul className="context-inspector-tools">
              {preview.tools.map((tool) => (
                <li key={tool.name}>
                  <code>{tool.name}</code>
                  {tool.description ? ` — ${tool.description}` : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="context-inspector-section">
            <h4 className="context-inspector-heading">Voice recordings</h4>
            {recordings.length > 0 ? (
              <ul className="context-inspector-recordings">
                {recordings.map((recording) => (
                  <li key={recording.path}>
                    <span className="context-inspector-recording-name">
                      {recording.filename}
                      {!recording.exists ? " (missing)" : ""}
                    </span>
                    {recording.exists ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => showRecordingInFinder(recording.path)}
                      >
                        Show in Finder
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="context-inspector-empty">No linked recordings for this chat.</p>
            )}
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
