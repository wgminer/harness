export type LayoutDebugTarget = {
  id: string;
  label: string;
  selector: string;
  /** Measure every match (messages, stream blocks). Default: first only. */
  all?: boolean;
  color: string;
};

/** Layout chrome, message parts, and spacers — not a shipped product surface. */
export const LAYOUT_DEBUG_TARGETS: LayoutDebugTarget[] = [
  { id: "titlebar", label: "Titlebar", selector: ".app-titlebar", color: "#7dd3fc" },
  { id: "sidebar", label: "Sidebar", selector: ".sidebar-dock", color: "#a78bfa" },
  { id: "main", label: "Main", selector: ".main", color: "#94a3b8" },
  { id: "chat-host", label: "Chat host", selector: ".main-chat-host", color: "#64748b" },
  { id: "chat-pane", label: "Chat pane", selector: ".chat-pane", color: "#38bdf8" },
  { id: "compose-pane", label: "Compose pane", selector: ".new-chat-pane", color: "#38bdf8" },
  { id: "compose-center", label: "Compose center", selector: ".new-chat-center", color: "#22d3ee" },
  { id: "compose-stack", label: "Compose stack", selector: ".new-chat-center-stack", color: "#67e8f9" },
  { id: "compose-composer", label: "Compose composer", selector: ".new-chat-composer", color: "#fbbf24" },
  { id: "scroll", label: "Scrollport", selector: ".chat-scroll", color: "#f472b6" },
  { id: "transcript", label: "Transcript column", selector: ".chat-area-inner", color: "#34d399" },
  { id: "stack", label: "Message stack", selector: ".chat-messages-stack", color: "#6ee7b7" },
  { id: "live-edge", label: "Live-edge spacer", selector: ".chat-live-edge", color: "#f87171" },
  { id: "composer-dock", label: "Composer dock", selector: ".chat-composer-dock", color: "#fb923c" },
  { id: "composer", label: "Composer", selector: ".chat-composer-inner", color: "#fbbf24" },
  { id: "dictation-actions", label: "Dictation actions", selector: ".chat-dictation-actions", color: "#fdba74" },
  { id: "secondary-actions", label: "Secondary actions", selector: ".chat-secondary-actions", color: "#fdba74" },
  { id: "message", label: "Message", selector: ".message-block", color: "#818cf8", all: true },
  { id: "message-body", label: "Message body", selector: ".message-block > .content", color: "#a5b4fc", all: true },
  { id: "user-card", label: "User card", selector: ".message-user-card", color: "#2dd4bf", all: true },
  { id: "user-card-content", label: "User card content", selector: ".message-user-card__content", color: "#5eead4", all: true },
  { id: "message-footer", label: "Message footer", selector: ".message-block-footer", color: "#67e8f9", all: true },
  { id: "streaming", label: "Streaming assistant", selector: ".chat-streaming-assistant", color: "#c084fc", all: true },
  { id: "stream-block", label: "Stream block", selector: ".chat-stream-block", color: "#d8b4fe", all: true },
  { id: "wait", label: "Wait slot", selector: ".chat-stream-block--wait", color: "#e879f9" },
  { id: "tool-card", label: "Tool card", selector: ".tool-card", color: "#f0abfc", all: true },
  { id: "document-card", label: "Document card", selector: ".document-card", color: "#f5d0fe", all: true },
];

export const LAYOUT_DEBUG_EXCLUDE_SELECTOR = ".layout-debug-root";
