/**
 * Capture inbox: things captured on the phone, waiting to be processed on the desktop.
 * Wire format lives in `resources/contracts/capture.json` (shared with Rust and iOS).
 */
import contract from "../../resources/contracts/capture.json";

export const CAPTURE_CONTRACT = contract;

export type CaptureKind = "dictation" | "text" | "photo" | "file" | "link";
export type CaptureAttachmentRole = "audio" | "image" | "file";
export type InboxProcessAction = "task" | "note" | "chat" | "dismissed";

export interface InboxAttachment {
  name: string;
  role: CaptureAttachmentRole;
  mimeType?: string;
  bytes: number;
  /** Absolute path of the downloaded file on this machine. */
  path: string;
}

export interface InboxItem {
  id: string;
  kind: CaptureKind;
  createdAt: number;
  receivedAt: number;
  source?: string;
  text: string;
  url?: string;
  title?: string;
  attachments: InboxAttachment[];
  processedAt?: number;
  processedAs?: InboxProcessAction;
  /** Id of the task or note the capture became. */
  resultId?: string;
}

export interface InboxProcessOutcome {
  items: InboxItem[];
  resultId?: string;
}

const KIND_LABELS: Record<CaptureKind, string> = {
  dictation: "Dictation",
  text: "Text",
  photo: "Photo",
  file: "File",
  link: "Link",
};

const PROCESSED_LABELS: Record<InboxProcessAction, string> = {
  task: "Added to Tasks",
  note: "Saved as a note",
  chat: "Sent to chat",
  dismissed: "Dismissed",
};

export function captureKindLabel(kind: CaptureKind): string {
  return KIND_LABELS[kind] ?? "Capture";
}

export function processedLabel(action: InboxProcessAction | undefined): string {
  return (action && PROCESSED_LABELS[action]) ?? "Processed";
}

export function isInboxItemPending(item: InboxItem): boolean {
  return item.processedAt == null;
}

export function inboxPendingCount(items: InboxItem[]): number {
  return items.filter(isInboxItemPending).length;
}

/** Text handed to the chat composer: the capture text plus its link when not already quoted. */
export function inboxChatDraft(item: InboxItem): string {
  const text = item.text.trim();
  const url = item.url?.trim();
  if (!url || text.includes(url)) return text;
  return text ? `${text}\n\n${url}` : url;
}
