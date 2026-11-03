import type { ReactNode } from "react";
import { Download, KeyRound, Keyboard, Mic, RefreshCw } from "lucide-react";
import { CHAT_PROVIDERS } from "../../shared/chatProviders";
import { TRANSCRIPTION_ENGINES, type TranscriptionEngineId } from "../../shared/transcriptionEngines";
import { formatAudioDuration, formatRelativeTime } from "../../shared/usageFormat";
import { SettingsPane } from "./SettingsPanel";
import { SettingsTabPanel } from "./SettingsTabPanel";
import type { SettingsTabId } from "./settingsNavConfig";
import { useSystemStatus, type SystemStatus } from "./useSystemStatus";

type Tone = "ok" | "attention" | "idle";

interface Attention {
  id: string;
  icon: ReactNode;
  title: string;
  detail: string;
  actionLabel: string;
  onAction: () => void;
}

interface Tile {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
  tab?: SettingsTabId;
}

export interface StatusTabProps {
  engine: TranscriptionEngineId;
  globalFnHotkey: boolean;
  isMac: boolean;
  onOpenTab: (tab: SettingsTabId) => void;
}

const LOADING = "…";

function count(value: number | null): string {
  return value == null ? LOADING : value.toLocaleString();
}

function needsMicrophone(status: SystemStatus): boolean {
  return status.microphone === "denied" || status.microphone === "undetermined";
}

function attentionItems(
  status: SystemStatus,
  { engine, globalFnHotkey, isMac }: Omit<StatusTabProps, "onOpenTab">,
  actions: {
    openTab: (tab: SettingsTabId) => void;
    allowMicrophone: () => void;
    allowAccessibility: () => void;
  },
): Attention[] {
  const items: Attention[] = [];
  if (status.keys && !status.keys.chatReady) {
    items.push({
      id: "openai",
      icon: <KeyRound size={16} aria-hidden />,
      title: "Chat needs a model",
      detail: "Add an OpenAI key, or pick another provider. Chat and cleanup don't run without one.",
      actionLabel: "Set up",
      onAction: () => actions.openTab("connections"),
    });
  }
  if (needsMicrophone(status)) {
    items.push({
      id: "microphone",
      icon: <Mic size={16} aria-hidden />,
      title: "Dictation can't record",
      detail: "Microphone access is off for Harness in macOS.",
      actionLabel: "Allow microphone",
      onAction: actions.allowMicrophone,
    });
  }
  if (isMac && globalFnHotkey && status.accessibilityTrusted === false) {
    items.push({
      id: "accessibility",
      icon: <Keyboard size={16} aria-hidden />,
      title: "The Fn shortcut can't hear the key",
      detail: "Holding Fn in other apps needs Accessibility access.",
      actionLabel: "Open Accessibility",
      onAction: actions.allowAccessibility,
    });
  }
  if (status.sync?.configured && status.sync.lastError) {
    items.push({
      id: "sync",
      icon: <RefreshCw size={16} aria-hidden />,
      title: "Sync failed",
      detail: status.sync.lastError,
      actionLabel: "Review",
      onAction: () => actions.openTab("data"),
    });
  }
  if (engine !== "apple" && status.engine === "failed") {
    items.push({
      id: "engine",
      icon: <Download size={16} aria-hidden />,
      title: "The transcription model didn't download",
      detail: "Apple Speech is used until it does.",
      actionLabel: "Open Voice",
      onAction: () => actions.openTab("voice"),
    });
  }
  return items;
}

function statusTiles(
  status: SystemStatus,
  { engine, globalFnHotkey, isMac }: Omit<StatusTabProps, "onOpenTab">,
): Tile[] {
  const keys = status.keys;
  const engineLabel = TRANSCRIPTION_ENGINES.find((e) => e.id === engine)?.label ?? engine;
  const sync = status.sync;

  const dictation: Tile = needsMicrophone(status)
    ? { id: "dictation", label: "Dictation", value: "No microphone", detail: "Access is off in macOS", tone: "attention", tab: "voice" }
    : isMac && globalFnHotkey
      ? { id: "dictation", label: "Dictation", value: "Ready", detail: "Hold Fn anywhere", tone: "ok", tab: "voice" }
      : { id: "dictation", label: "Dictation", value: "Ready", detail: "In Harness only", tone: "ok", tab: "voice" };

  const transcription: Tile = {
    id: "transcription",
    label: "Transcription",
    value: engineLabel,
    detail:
      status.engine === "downloading"
        ? "Downloading the model"
        : status.engine === "failed"
          ? "Using Apple Speech for now"
          : engine === "apple"
            ? "Built into macOS"
            : "On this Mac",
    tone: status.engine === "failed" ? "attention" : status.engine === "downloading" ? "idle" : "ok",
    tab: "voice",
  };

  const syncTile: Tile = !sync
    ? { id: "sync", label: "Sync", value: LOADING, detail: "", tone: "idle", tab: "data" }
    : !sync.configured
      ? { id: "sync", label: "Sync", value: "Not set up", detail: "Back up to your own R2 bucket", tone: "idle", tab: "data" }
      : sync.lastError
        ? { id: "sync", label: "Sync", value: "Failed", detail: "Open Data to review", tone: "attention", tab: "data" }
        : {
            id: "sync",
            label: "Sync",
            value: sync.lastSuccessAt ? "Synced" : "Not synced yet",
            detail: sync.lastSuccessAt ? formatRelativeTime(sync.lastSuccessAt) : "Run a first sync",
            tone: sync.lastSuccessAt ? "ok" : "idle",
            tab: "data",
          };

  return [
    {
      id: "chat",
      label: "Chat",
      value: !keys ? LOADING : keys.chatReady ? "Ready" : "Needs a model",
      detail: !keys
        ? ""
        : keys.chatReady
          ? (CHAT_PROVIDERS.find((p) => p.id === keys.chatProvider)?.label ?? "")
          : "Add a key or pick a provider",
      tone: !keys ? "idle" : keys.chatReady ? "ok" : "attention",
      tab: "connections",
    },
    dictation,
    transcription,
    syncTile,
    {
      id: "search",
      label: "Web search",
      value: !keys ? LOADING : keys.tavily ? "Ready" : "Off",
      detail: keys?.tavily ? "Tavily key saved" : "Add a Tavily key to turn on",
      tone: keys?.tavily ? "ok" : "idle",
      tab: "connections",
    },
    {
      id: "images",
      label: "Images",
      value: !keys ? LOADING : keys.google ? "Google AI" : "Using OpenAI",
      detail: keys?.google ? "Google AI key saved" : "No Google AI key",
      tone: keys?.google ? "ok" : "idle",
      tab: "connections",
    },
    {
      id: "gmail",
      label: "Gmail",
      value: !status.gmail ? LOADING : status.gmail.connected ? "Connected" : "Not connected",
      detail: status.gmail?.connected ? "Asks before it sends" : "Optional",
      tone: status.gmail?.connected ? "ok" : "idle",
      tab: "connections",
    },
    {
      id: "memory",
      label: "Memory",
      value: count(status.memoryCount),
      detail: "Things Harness remembers",
      tone: "ok",
      tab: "data",
    },
  ];
}

function TileBody({ tile }: { tile: Tile }) {
  return (
    <>
      <span className="settings-tile__top">
        {tile.label}
        <span className={`settings-dot settings-dot--${tile.tone}`} aria-hidden />
      </span>
      <span className="settings-tile__value">{tile.value}</span>
      <span className="settings-tile__detail">{tile.detail}</span>
    </>
  );
}

export function StatusTab({ engine, globalFnHotkey, isMac, onOpenTab }: StatusTabProps) {
  const { status, allowMicrophone, allowAccessibility } = useSystemStatus({ engine, isMac });
  const context = { engine, globalFnHotkey, isMac };
  const attention = attentionItems(status, context, {
    openTab: onOpenTab,
    allowMicrophone: () => void allowMicrophone(),
    allowAccessibility,
  });
  const tiles = statusTiles(status, context);
  const usage = status.usage;
  const loaded = status.keys != null && status.microphone != null;
  const summary: Tile =
    attention.length > 0
      ? {
          id: "summary",
          label: "Status",
          value: attention.length === 1 ? "1 issue" : `${attention.length} issues`,
          detail: "See above",
          tone: "attention",
        }
      : loaded
        ? { id: "summary", label: "Status", value: "All systems go", detail: "", tone: "ok" }
        : { id: "summary", label: "Status", value: LOADING, detail: "", tone: "idle" };

  const stats: Array<{ label: string; value: string }> = [
    { label: "Conversations", value: count(usage.conversations) },
    { label: "Started this week", value: count(usage.conversationsThisWeek) },
    { label: "Words dictated", value: count(usage.wordsDictated) },
    { label: "Audio recorded", value: usage.audioMs == null ? LOADING : formatAudioDuration(usage.audioMs) },
    { label: "Recordings", value: count(usage.recordings) },
    { label: "Notes", value: count(usage.notes) },
    { label: "Open tasks", value: count(usage.openTasks) },
    { label: "Images", value: count(usage.images) },
  ];

  return (
    <SettingsTabPanel id="status">
      {attention.length > 0 ? (
        <SettingsPane title="Needs you">
          {attention.map((item) => (
            <div key={item.id} className="settings-row settings-attention" data-testid={`settings-attention-${item.id}`}>
              <span className="settings-attention__icon">{item.icon}</span>
              <span className="settings-row__text">
                <span className="settings-row__label">{item.title}</span>
                <span className="settings-row__desc">{item.detail}</span>
              </span>
              <button type="button" className="btn btn-sm btn-primary" onClick={item.onAction}>
                {item.actionLabel}
              </button>
            </div>
          ))}
        </SettingsPane>
      ) : null}

      <SettingsPane title="Harness" bare>
        <div className="settings-tiles">
          <div
            className={`settings-tile settings-tile--static${summary.tone === "attention" ? " settings-tile--attention" : ""}`}
            data-testid="settings-status-summary"
            role="status"
          >
            <TileBody tile={summary} />
          </div>
          {tiles.map((tile) => (
            <button
              key={tile.id}
              type="button"
              className={`settings-tile${tile.tone === "attention" ? " settings-tile--attention" : ""}`}
              data-testid={`settings-status-${tile.id}`}
              onClick={() => tile.tab && onOpenTab(tile.tab)}
            >
              <TileBody tile={tile} />
            </button>
          ))}
        </div>
      </SettingsPane>

      <SettingsPane title="Usage" bare>
        <dl className="settings-stats">
          {stats.map((stat) => (
            <div key={stat.label} className="settings-stat">
              <dt className="settings-stat__label">{stat.label}</dt>
              <dd className="settings-stat__value">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </SettingsPane>
    </SettingsTabPanel>
  );
}
