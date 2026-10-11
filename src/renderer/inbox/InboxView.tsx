import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CheckLine,
  ChevronRight,
  Circle,
  File as FileIcon,
  Image as ImageIcon,
  Link as LinkIcon,
  Mic,
  Pause,
  Play,
  RefreshCw,
  StickyNote,
  Type,
  type LucideIcon,
} from "lucide-react";
import {
  captureKindLabel,
  isInboxItemPending,
  processedLabel,
  type CaptureKind,
  type InboxAttachment,
  type InboxItem,
  type InboxProcessAction,
} from "../../shared/inbox";
import { WorkspaceHeader } from "../ui/WorkspaceHeader";
import type { InboxState } from "./useInbox";

const KIND_ICONS: Record<CaptureKind, LucideIcon> = {
  dictation: Mic,
  text: Type,
  photo: ImageIcon,
  file: FileIcon,
  link: LinkIcon,
};

function formatCapturedAt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function localFileUrl(path: string): Promise<string> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}

function AttachmentView({ attachment }: { attachment: InboxAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (attachment.role === "file") return;
    let cancelled = false;
    void localFileUrl(attachment.path)
      .then((next) => {
        if (!cancelled) setUrl(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
  }, [attachment.path, attachment.role]);

  if (attachment.role === "image") {
    return url ? <img className="inbox-attachment-image" src={url} alt={attachment.name} /> : null;
  }

  if (attachment.role === "audio") {
    const toggle = () => {
      if (!url) return;
      if (playing) {
        audioRef.current?.pause();
        setPlaying(false);
        return;
      }
      const audio = audioRef.current ?? new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.onerror = () => setPlaying(false);
      setPlaying(true);
      void audio.play().catch(() => setPlaying(false));
    };
    return (
      <button type="button" className="btn btn-sm inbox-attachment-chip" onClick={toggle} disabled={!url}>
        {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
        {playing ? "Pause recording" : "Play recording"}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-sm inbox-attachment-chip"
      onClick={() => void window.harness.system.showInFolder(attachment.path)}
      title="Show in Finder"
    >
      <FileIcon size={14} aria-hidden />
      {attachment.name}
    </button>
  );
}

function CaptureText({ item, onSave }: { item: InboxItem; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(item.text);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setDraft(item.text), [item.text]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  return (
    <textarea
      ref={ref}
      className="inbox-text"
      value={draft}
      rows={1}
      placeholder="Add a note…"
      aria-label={`${captureKindLabel(item.kind)} text`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== item.text) onSave(draft);
      }}
    />
  );
}

function CaptureHeader({ item }: { item: InboxItem }) {
  const Icon = KIND_ICONS[item.kind] ?? Circle;
  return (
    <div className="inbox-item-meta">
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      <span>{captureKindLabel(item.kind)}</span>
      <span className="inbox-item-time">{formatCapturedAt(item.createdAt)}</span>
    </div>
  );
}

function CaptureLink({ item }: { item: InboxItem }) {
  if (!item.url) return null;
  return (
    <a className="inbox-link" href={item.url} target="_blank" rel="noreferrer">
      {item.title?.trim() || item.url}
    </a>
  );
}

interface InboxViewProps {
  inbox: InboxState;
  /** Open a new chat with the capture in the composer. */
  onStartChat: (item: InboxItem) => void;
}

export function InboxView({ inbox, onStartChat }: InboxViewProps) {
  const { items, loading, error, refresh, updateText, process, restore, clearProcessed } = inbox;
  const [refreshing, setRefreshing] = useState(false);
  const [processedOpen, setProcessedOpen] = useState(false);

  const pending = items.filter(isInboxItemPending);
  const processed = items.filter((item) => !isInboxItemPending(item));

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const handleProcess = (item: InboxItem, action: InboxProcessAction) => {
    if (action === "chat") onStartChat(item);
    void process(item.id, action);
  };

  return (
    <div className="workspace-page inbox-page">
      <div className="workspace-scroll">
        <WorkspaceHeader
          title="Inbox"
          actions={
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              data-testid="inbox-refresh"
            >
              <RefreshCw size={14} aria-hidden />
              {refreshing ? "Checking…" : "Check for captures"}
            </button>
          }
        />
        <div className="workspace-content workspace-stack inbox-content">
          {error && (
            <p className="inbox-lead inbox-lead--error" role="alert">
              {error}
            </p>
          )}
          {loading ? null : pending.length === 0 ? (
            <p className="inbox-lead" data-testid="inbox-empty">
              Nothing to process. Captures from your phone land here.
            </p>
          ) : (
            <ul className="inbox-list" data-testid="inbox-list">
              {pending.map((item) => (
                <li key={item.id} className="inbox-item">
                  <CaptureHeader item={item} />
                  <CaptureText item={item} onSave={(text) => void updateText(item.id, text)} />
                  <CaptureLink item={item} />
                  {item.attachments.length > 0 && (
                    <div className="inbox-attachments">
                      {item.attachments.map((attachment) => (
                        <AttachmentView key={attachment.name} attachment={attachment} />
                      ))}
                    </div>
                  )}
                  <div className="inbox-actions">
                    <button type="button" className="btn btn-sm" onClick={() => handleProcess(item, "task")}>
                      <CheckLine size={14} aria-hidden />
                      Task
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => handleProcess(item, "note")}>
                      <StickyNote size={14} aria-hidden />
                      Note
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => handleProcess(item, "chat")}>
                      <Circle size={14} aria-hidden />
                      Chat
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost inbox-dismiss"
                      onClick={() => handleProcess(item, "dismissed")}
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {processed.length > 0 && (
            <div className="inbox-processed">
              <div className="inbox-processed-heading">
                <button
                  type="button"
                  className="inbox-section-heading"
                  aria-expanded={processedOpen}
                  onClick={() => setProcessedOpen((open) => !open)}
                >
                  <ChevronRight
                    className={`inbox-section-caret${processedOpen ? " inbox-section-caret--open" : ""}`}
                    aria-hidden
                  />
                  <span>Processed</span>
                  <span className="inbox-section-count">{processed.length}</span>
                </button>
                {processedOpen && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void clearProcessed()}>
                    Clear processed
                  </button>
                )}
              </div>
              {processedOpen && (
                <ul className="inbox-list">
                  {processed.map((item) => (
                    <li key={item.id} className="inbox-item inbox-item--processed">
                      <CaptureHeader item={item} />
                      <p className="inbox-processed-text">{item.text || item.title || item.url}</p>
                      <div className="inbox-actions">
                        <span className="inbox-processed-as">{processedLabel(item.processedAs)}</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost inbox-dismiss"
                          onClick={() => void restore(item.id)}
                        >
                          Restore
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
