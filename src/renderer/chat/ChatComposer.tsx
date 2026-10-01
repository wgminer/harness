import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  Mic,
  Check,
  Loader2,
  X,
  FileAudio,
  ArrowUp,
  Plus,
  FolderCode,
  FileText,
  FolderOpen,
  Paperclip,
  AppWindow,
} from "lucide-react";
import type { CodingScopeMeta } from "../../shared/desktopAPI";
import type { VoiceState } from "./chatHelpers";
import { QaChoicePanel } from "./QaChoicePanel";
import {
  fileFromAudioPath,
  isAudioAttachFile,
  isAudioAttachPath,
} from "../recording/audioAttach";
import { Menu, MenuCheckItem, MenuItem, MenuSeparator } from "../ui/Menu";
import { AttachmentCard } from "./AttachmentCard";
import { attachRejectedMessage, fileExtensionLabel, readTextAttachment } from "./fileAttach";
import { useTypedPlaceholder } from "./useTypedPlaceholder";
import { formatVoiceTimer } from "../recording/useVoiceCapture";
import {
  pastedTextPreview,
  pastedTextSizeLabel,
  shouldAttachPaste,
  type PastedTextBlock,
} from "./pastedText";

function codingScopeLabel(scope: CodingScopeMeta): string {
  if (scope.kind === "self") return "Harness UI";
  const parts = scope.root.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || scope.root;
}

/** Dropped text files read through the backend share the composer's text attach cap. */
const MAX_DROP_TEXT_CHARS = 512 * 1024;

/** Parent folder of a project root, home-relative, e.g. "~/Projects". */
function codingScopeParent(root: string): string {
  const parts = root.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  parts.pop();
  return parts.join("/").replace(/^\/(Users|home)\/[^/]+/, "~") || "/";
}

interface ChatComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  stopping?: boolean;
  voiceState: VoiceState;
  voiceError: string | null;
  recordingMs: number;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  attachedAudioName: string | null;
  attachmentTranscribing: boolean;
  attachmentError: string | null;
  onAttachAudio: (file: File | null) => void;
  onRemoveAttachedAudio: () => void;
  /** Shown when a dropped/picked file cannot be attached. */
  onAttachmentError?: (message: string | null) => void;
  /** Text files picked or dropped; omit to accept audio only. */
  onAttachText?: (text: string, name: string) => void;
  /** Large pastes shown as attachments; omit `onPasteLarge` to paste everything inline. */
  pastedBlocks?: PastedTextBlock[];
  onPasteLarge?: (text: string) => void;
  onRemovePastedBlock?: (id: string) => void;
  onInlinePastedBlock?: (id: string) => void;
  focusComposerNonce?: number;
  inputRef?: MutableRefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  modeControl?: ReactNode;
  /** Q&A stacked choices shown above the textarea when present. */
  qaChoices?: string[];
  /** Animate the chooser open. Used after a turn, not when opening a thread. */
  qaChoicesArrive?: boolean;
  onQaChoiceSelect?: (label: string) => void;
  codingScope?: CodingScopeMeta | null;
  selfScopeAvailable?: boolean;
  onPickProjectFolder?: () => Promise<void> | void;
  onUseSelfScope?: () => Promise<void> | void;
  onClearCodingScope?: () => Promise<void> | void;
  /** Shift+Tab in the composer cycles chat modes. */
  onCycleMode?: () => void;
  /**
   * `inline` keeps the textarea and compact controls on one row until the draft
   * outgrows a single line, then grows into the stacked layout. `stacked` always
   * puts the textarea above the action row.
   */
  layout?: "inline" | "stacked";
}

/** Collapse back to inline once the draft is this fraction of the length that expanded it. */
const INLINE_COLLAPSE_RATIO = 0.8;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function ChatComposer({
  input,
  onInputChange,
  onSend,
  onStop,
  sending,
  stopping = false,
  voiceState,
  voiceError,
  recordingMs,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  attachedAudioName,
  attachmentTranscribing,
  attachmentError,
  onAttachAudio,
  onRemoveAttachedAudio,
  onAttachmentError,
  onAttachText,
  pastedBlocks = [],
  onPasteLarge,
  onRemovePastedBlock,
  onInlinePastedBlock,
  focusComposerNonce,
  inputRef: externalInputRef,
  placeholder = "Write a message…",
  modeControl,
  qaChoices,
  qaChoicesArrive,
  onQaChoiceSelect,
  codingScope = null,
  selfScopeAvailable = false,
  onPickProjectFolder,
  onUseSelfScope,
  onClearCodingScope,
  onCycleMode,
  layout = "inline",
}: ChatComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null) as MutableRefObject<HTMLTextAreaElement | null>;
  const innerRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const dragDepthRef = useRef(0);
  const attachDisabledRef = useRef(false);
  const [dropTargetActive, setDropTargetActive] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [plusBusy, setPlusBusy] = useState(false);
  const typedPlaceholder = useTypedPlaceholder(placeholder);
  const [expanded, setExpanded] = useState(false);
  const expandedAtLengthRef = useRef(0);
  const growFromHeightRef = useRef<number | null>(null);
  const inline = layout === "inline" && !expanded;

  const attachDisabled =
    voiceState !== "idle" || sending || attachmentTranscribing;
  attachDisabledRef.current = attachDisabled;

  // Auto-grow textarea to fit content (up to CSS max-height). Inline mode stays
  // one line tall and switches to stacked as soon as the draft would wrap.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (layout === "inline") {
      const shouldCollapse =
        expanded &&
        !input.includes("\n") &&
        input.length < expandedAtLengthRef.current * INLINE_COLLAPSE_RATIO;
      if (shouldCollapse) {
        growFromHeightRef.current = innerRef.current?.offsetHeight ?? null;
        setExpanded(false);
        return;
      }
    }
    if (inline && !input) {
      // An empty textarea measures its (possibly wrapped) placeholder; keep it one line.
      el.style.height = "";
      return;
    }
    const fromHeight = innerRef.current?.offsetHeight ?? null;
    el.style.height = "auto";
    if (inline && (el.scrollHeight > el.clientHeight + 1 || input.includes("\n"))) {
      growFromHeightRef.current = fromHeight;
      expandedAtLengthRef.current = input.length;
      setExpanded(true);
      return;
    }
    el.style.height = `${el.scrollHeight}px`;
  }, [input, inline, expanded, layout]);

  // Animate the card between inline and stacked: FLIP the height, fade the actions in.
  useLayoutEffect(() => {
    const el = innerRef.current;
    const from = growFromHeightRef.current;
    growFromHeightRef.current = null;
    if (!el || from == null || prefersReducedMotion()) return;
    const to = el.offsetHeight;
    if (Math.abs(to - from) < 1) return;
    const easing = "cubic-bezier(0.2, 0.8, 0.2, 1)";
    el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 240, easing });
    actionsRef.current?.animate(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 200, delay: 60, easing, fill: "backwards" },
    );
  }, [inline]);

  useEffect(() => {
    if (focusComposerNonce == null || focusComposerNonce < 1) return;
    inputRef.current?.focus();
  }, [focusComposerNonce]);

  const clearDropTarget = useCallback(() => {
    dragDepthRef.current = 0;
    setDropTargetActive(false);
  }, []);

  /** Audio is staged for transcription on send; text files become named text blocks. */
  const attachFiles = useCallback(
    async (files: FileList | File[] | null | undefined) => {
      if (attachDisabledRef.current || !files || files.length === 0) return;
      const rejected: string[] = [];
      let audioTaken = false;
      for (const file of Array.from(files)) {
        if (isAudioAttachFile(file)) {
          if (audioTaken) rejected.push(file.name);
          else {
            onAttachAudio(file);
            audioTaken = true;
          }
          continue;
        }
        const text = onAttachText ? await readTextAttachment(file) : null;
        if (text != null) onAttachText?.(text, file.name);
        else rejected.push(file.name);
      }
      onAttachmentError?.(rejected.length > 0 ? attachRejectedMessage(rejected) : null);
    },
    [onAttachAudio, onAttachText, onAttachmentError],
  );

  const attachPaths = useCallback(
    async (paths: string[]) => {
      if (attachDisabledRef.current || paths.length === 0) return;
      const rejected: string[] = [];
      let audioTaken = false;
      for (const path of paths) {
        const name = path.split(/[/\\]/).pop() || path;
        try {
          if (isAudioAttachPath(path)) {
            if (audioTaken) {
              rejected.push(name);
              continue;
            }
            const staged = await window.harness.recording.stageDroppedAudio(path);
            onAttachAudio(await fileFromAudioPath(staged.path, staged.name));
            audioTaken = true;
          } else if (onAttachText) {
            const file = await window.harness.files.readText(path);
            if (file.content.length > 0 && file.content.length <= MAX_DROP_TEXT_CHARS) {
              onAttachText(file.content, file.name);
            } else rejected.push(name);
          } else rejected.push(name);
        } catch {
          rejected.push(name);
        }
      }
      onAttachmentError?.(rejected.length > 0 ? attachRejectedMessage(rejected) : null);
    },
    [onAttachAudio, onAttachText, onAttachmentError],
  );

  // Tauri intercepts OS file drops; HTML5 drag events never fire in the webview.
  // Listen to the native drag-drop API and accept drops anywhere on the window.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        if (cancelled) return;
        unlisten = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            if (!attachDisabledRef.current) setDropTargetActive(true);
            return;
          }
          if (payload.type === "leave") {
            clearDropTarget();
            return;
          }
          if (payload.type === "drop") {
            clearDropTarget();
            void attachPaths(payload.paths);
          }
        });
      } catch {
        // Browser / Storybook — HTML5 handlers below cover file drops.
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [clearDropTarget, attachPaths]);

  const runPlusAction = async (fn: () => Promise<void> | void) => {
    if (plusBusy || attachDisabled) return;
    setPlusBusy(true);
    try {
      await fn();
      setPlusOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setPlusBusy(false);
    }
  };

  return (
    <>
      {voiceError && (
        <div className="voice-error">{voiceError}</div>
      )}
      {attachmentError && (
        <div className="voice-error">{attachmentError}</div>
      )}
      <div
        ref={innerRef}
        className={`chat-composer-inner${inline ? " chat-composer-inner--inline" : ""}${dropTargetActive ? " chat-composer-inner--drop-target" : ""}`}
        onKeyDown={(e) => {
          if (e.key === "Tab" && e.shiftKey && onCycleMode && !e.altKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (!sending) onCycleMode();
          }
        }}
        onDragEnter={(e) => {
          if (attachDisabled) return;
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          dragDepthRef.current += 1;
          setDropTargetActive(true);
        }}
        onDragOver={(e) => {
          if (attachDisabled) return;
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(e) => {
          if (attachDisabled) return;
          e.preventDefault();
          e.stopPropagation();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDropTargetActive(false);
        }}
        onDrop={(e) => {
          if (attachDisabled) return;
          e.preventDefault();
          e.stopPropagation();
          clearDropTarget();
          void attachFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="chat-file-input"
          multiple
          onChange={(e) => {
            const picked = e.target.files ? Array.from(e.target.files) : [];
            e.currentTarget.value = "";
            void attachFiles(picked);
          }}
        />
        {codingScope ? (
          <div className="chat-scope-row">
            <div className="chat-scope-pill" title={codingScope.root} data-testid="chat-coding-scope">
              <FolderCode size={12} strokeWidth={1.75} aria-hidden />
              <span className="chat-scope-pill__label">{codingScopeLabel(codingScope)}</span>
              {codingScope.kind === "project" ? (
                <span className="chat-scope-pill__path">{codingScopeParent(codingScope.root)}</span>
              ) : null}
              <button
                type="button"
                className="chat-scope-pill__dismiss"
                onClick={() => void onClearCodingScope?.()}
                disabled={sending}
                aria-label="Clear workspace"
                title="Clear workspace"
              >
                <X size={12} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ) : null}
        {(attachedAudioName || pastedBlocks.length > 0) && (
          <div className="chat-attachment-strip">
            {attachedAudioName ? (
              <AttachmentCard
                icon={
                  attachmentTranscribing ? (
                    <Loader2 size={12} className="voice-spinner" aria-hidden />
                  ) : (
                    <FileAudio size={12} strokeWidth={1.75} aria-hidden />
                  )
                }
                title={attachedAudioName}
                meta={
                  attachmentTranscribing
                    ? "Transcribing…"
                    : `${fileExtensionLabel(attachedAudioName) || "Audio"} · Transcribed on send`
                }
                onRemove={onRemoveAttachedAudio}
                removeLabel="Remove attached audio"
                removeDisabled={attachmentTranscribing}
              />
            ) : null}
            {pastedBlocks.map((block) => {
              const ext = block.name ? fileExtensionLabel(block.name) : "";
              return (
                <AttachmentCard
                  key={block.id}
                  variant={block.name ? "file" : "paste"}
                  icon={<FileText size={12} strokeWidth={1.75} aria-hidden />}
                  title={block.name ?? (pastedTextPreview(block.text) || "Pasted text")}
                  meta={`${block.name ? ext || "Text" : "Pasted"} · ${pastedTextSizeLabel(block.text)}`}
                  onOpen={onInlinePastedBlock ? () => onInlinePastedBlock(block.id) : undefined}
                  openLabel="Move into the message"
                  onRemove={() => onRemovePastedBlock?.(block.id)}
                  removeLabel={block.name ? `Remove ${block.name}` : "Remove pasted text"}
                  disabled={sending}
                />
              );
            })}
          </div>
        )}
        {qaChoices && qaChoices.length >= 2 && onQaChoiceSelect ? (
          <QaChoicePanel
            options={qaChoices}
            onSelect={onQaChoiceSelect}
            disabled={sending}
            arrive={qaChoicesArrive}
          />
        ) : null}
        <div className="chat-composer-row">
          <textarea
            ref={(el) => {
              inputRef.current = el;
              if (externalInputRef) externalInputRef.current = el;
            }}
            className="chat-input"
            data-testid="chat-input"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onPaste={(e) => {
              if (!onPasteLarge) return;
              const text = e.clipboardData.getData("text/plain");
              if (!text || !shouldAttachPaste(text)) return;
              e.preventDefault();
              onPasteLarge(text);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={typedPlaceholder}
            disabled={voiceState === "recording" || voiceState === "processing" || attachmentTranscribing}
            rows={1}
          />
          <div ref={actionsRef} className="input-actions">
            {voiceState === "recording" && (
              <span className="voice-timer">
                {formatVoiceTimer(recordingMs)}
              </span>
            )}
            {voiceState === "processing" && (
              <span className="voice-status">
                <Loader2 size={13} className="voice-spinner" />
                Transcribing…
              </span>
            )}
            <div className="input-actions-spacer" />
            <button
              ref={plusRef}
              type="button"
              className={`btn btn-icon chat-pane-btn chat-pane-btn--icon voice-btn${codingScope ? " coding-scope-plus--active" : ""}`}
              onClick={() => setPlusOpen((v) => !v)}
              disabled={attachDisabled || plusBusy}
              title="Add files or set a project folder"
              aria-label="Add files or set a project folder"
              aria-haspopup="menu"
              aria-expanded={plusOpen}
            >
              <Plus size={15} />
            </button>
            <Menu
              open={plusOpen}
              onClose={() => setPlusOpen(false)}
              anchorRef={plusRef}
              placement="bottom-end"
              gap={8}
              label="Add files or set a project folder"
            >
              <MenuItem
                icon={<Paperclip size={14} strokeWidth={1.75} />}
                onSelect={() => fileInputRef.current?.click()}
              >
                Add files…
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={<FolderOpen size={14} strokeWidth={1.75} />}
                trailing={codingScope?.kind === "project" ? codingScopeLabel(codingScope) : undefined}
                keepOpen
                onSelect={() => void runPlusAction(async () => onPickProjectFolder?.())}
              >
                Project folder…
              </MenuItem>
              {selfScopeAvailable ? (
                <MenuCheckItem
                  icon={<AppWindow size={14} strokeWidth={1.75} />}
                  kind="checkbox"
                  checked={codingScope?.kind === "self"}
                  onSelect={() => void runPlusAction(async () => onUseSelfScope?.())}
                  onClose={() => {}}
                >
                  Harness UI
                </MenuCheckItem>
              ) : null}
              {codingScope ? (
                <MenuItem
                  icon={<X size={14} strokeWidth={1.75} />}
                  keepOpen
                  onSelect={() => void runPlusAction(async () => onClearCodingScope?.())}
                >
                  Clear workspace
                </MenuItem>
              ) : null}
            </Menu>
            {voiceState !== "processing" && (
              <button
                type="button"
                className={`btn btn-icon chat-pane-btn chat-pane-btn--icon${voiceState === "recording" ? " btn-primary" : " voice-btn"}`}
                onClick={voiceState === "recording" ? onStopRecording : onStartRecording}
                disabled={sending}
                title={voiceState === "recording" ? "Stop recording" : "Record voice message"}
                aria-label={voiceState === "recording" ? "Stop recording" : "Start recording"}
              >
                {voiceState === "recording" ? <Check size={15} /> : <Mic size={15} />}
              </button>
            )}
            {voiceState !== "idle" && (
              <button
                type="button"
                className="btn btn-icon btn-danger chat-pane-btn chat-pane-btn--icon"
                onClick={onCancelRecording}
                title="Cancel recording"
                aria-label="Cancel recording"
              >
                <X size={15} />
              </button>
            )}
            {modeControl}
            {sending ? (
              <button
                type="button"
                className={`btn chat-pane-btn input-actions-stop${stopping ? " input-actions-stop--stopping" : ""}`}
                onClick={onStop}
                disabled={stopping}
                aria-busy={stopping}
                title={stopping ? "Stopping the request…" : "Stop and kill this request"}
                aria-label={stopping ? "Stopping the request" : "Stop and kill this request"}
              >
                {stopping ? "Stopping…" : "Stop"}
              </button>
            ) : voiceState === "idle" ? (
              <button
                type="button"
                className="btn btn-icon chat-pane-btn chat-pane-btn--icon"
                data-testid="chat-send"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onSend}
                disabled={
                  (!input.trim() && !attachedAudioName && pastedBlocks.length === 0) ||
                  attachmentTranscribing
                }
                title="Send message"
                aria-label="Send message"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
