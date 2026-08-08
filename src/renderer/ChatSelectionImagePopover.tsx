import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { RefreshCw } from "lucide-react";
import { DEFAULT_SETTINGS, type Settings } from "../shared/types";
import { settingsSection } from "../shared/settingsPage";
import { getCachedSettings } from "./settings/settingsSessionCache";

const DEBOUNCE_MS = 350;
const MIN_CHARS = 2;
const MAX_CHARS = 120;
const POPOVER_WIDTH = 220;
const POPOVER_GAP = 8;

type LookupState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "ready"; query: string; imageUrl: string; description?: string }
  | { kind: "empty"; query: string }
  | { kind: "error"; query: string; message: string }
  | { kind: "imgError"; query: string; imageUrl: string; description?: string };

function isIgnoredNode(node: Node | null): boolean {
  let el: Element | null =
    node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement ?? null;
  while (el) {
    if (el.closest("button, input, textarea, select, a, .md-code-block__toolbar")) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

function selectionInMessageContent(root: HTMLElement): { text: string; rect: DOMRect } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount < 1) return null;

  const range = sel.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const contentEl =
    common.nodeType === Node.ELEMENT_NODE
      ? (common as Element).closest(".message-block .content")
      : common.parentElement?.closest(".message-block .content");
  if (!contentEl || !root.contains(contentEl)) return null;
  if (isIgnoredNode(range.startContainer) || isIgnoredNode(range.endContainer)) return null;

  const text = sel.toString().replace(/\s+/g, " ").trim();
  if (text.length < MIN_CHARS) return null;
  const clamped = text.slice(0, MAX_CHARS).trim();
  if (clamped.length < MIN_CHARS) return null;

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { text: clamped, rect };
}

function readSelectionImageLookupEnabled(): boolean {
  const cached = getCachedSettings();
  if (cached) {
    return cached.chat?.selectionImageLookup ?? DEFAULT_SETTINGS.chat!.selectionImageLookup;
  }
  return DEFAULT_SETTINGS.chat!.selectionImageLookup;
}

interface ChatSelectionImagePopoverProps {
  containerRef: RefObject<HTMLElement | null>;
}

export function ChatSelectionImagePopover({ containerRef }: ChatSelectionImagePopoverProps) {
  const [enabled, setEnabled] = useState(readSelectionImageLookupEnabled);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [state, setState] = useState<LookupState>({ kind: "idle" });
  const popoverRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const activeQueryRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (window.harness.settings.get() as Promise<Settings>).then((settings) => {
      if (cancelled) return;
      setEnabled(
        settings.chat?.selectionImageLookup ?? DEFAULT_SETTINGS.chat!.selectionImageLookup,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    requestIdRef.current += 1;
    activeQueryRef.current = null;
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setOpen(false);
    setState({ kind: "idle" });
  }, []);

  const placePopover = useCallback(
    (rect: DOMRect) => {
      const container = containerRef.current;
      if (!container) return;
      const rootRect = container.getBoundingClientRect();
      const maxLeft = Math.max(8, rootRect.width - POPOVER_WIDTH - 8);
      let left = rect.left - rootRect.left + rect.width / 2 - POPOVER_WIDTH / 2;
      left = Math.min(maxLeft, Math.max(8, left));
      let top = rect.bottom - rootRect.top + POPOVER_GAP;
      const estimatedHeight = 180;
      if (top + estimatedHeight > rootRect.height - 8) {
        top = Math.max(8, rect.top - rootRect.top - estimatedHeight - POPOVER_GAP);
      }
      setPosition({ top, left });
    },
    [containerRef],
  );

  const runLookup = useCallback(async (query: string) => {
    const requestId = ++requestIdRef.current;
    activeQueryRef.current = query;
    setState({ kind: "loading", query });
    try {
      const result = await window.harness.search.lookupImage(query);
      if (requestId !== requestIdRef.current) return;
      if (result.error) {
        setState({ kind: "error", query, message: result.error });
        return;
      }
      if (!result.imageUrl) {
        setState({ kind: "empty", query });
        return;
      }
      setState({
        kind: "ready",
        query,
        imageUrl: result.imageUrl,
        description: result.description,
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setState({
        kind: "error",
        query,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const syncFromSelection = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      dismiss();
      return;
    }
    const found = selectionInMessageContent(container);
    if (!found) {
      dismiss();
      return;
    }

    placePopover(found.rect);
    setOpen(true);

    if (activeQueryRef.current === found.text) {
      return;
    }

    // Show the shell immediately; debounce the network call.
    // Invalidate any in-flight lookup so a prior response cannot overwrite this selection.
    requestIdRef.current += 1;
    activeQueryRef.current = null;
    setState({ kind: "loading", query: found.text });
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      void runLookup(found.text);
    }, DEBOUNCE_MS);
  }, [containerRef, dismiss, placePopover, runLookup]);

  useEffect(() => {
    if (!enabled) {
      dismiss();
      return;
    }

    const onSelectionChange = () => {
      // Defer so mouseup finishes updating the selection.
      window.requestAnimationFrame(() => syncFromSelection());
    };
    const onMouseUp = () => {
      window.requestAnimationFrame(() => syncFromSelection());
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const onScroll = () => {
      if (!open) return;
      const container = containerRef.current;
      if (!container) return;
      const found = selectionInMessageContent(container);
      if (!found) {
        dismiss();
        return;
      }
      placePopover(found.rect);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    const scrollEl = containerRef.current?.querySelector(".chat-scroll");
    scrollEl?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
      scrollEl?.removeEventListener("scroll", onScroll);
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [containerRef, dismiss, enabled, open, placePopover, syncFromSelection]);

  if (!enabled || !open || state.kind === "idle") return null;

  const queryLabel =
    state.kind === "loading" ||
    state.kind === "ready" ||
    state.kind === "empty" ||
    state.kind === "error" ||
    state.kind === "imgError"
      ? state.query
      : "";

  return (
    <div
      ref={popoverRef}
      className="chat-selection-image"
      role="dialog"
      aria-label={queryLabel ? `Image for “${queryLabel}”` : "Selection image"}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="chat-selection-image__media">
        {state.kind === "loading" ? (
          <div className="chat-selection-image__status" aria-live="polite">
            <RefreshCw size={16} aria-hidden className="chat-selection-image__spin" />
          </div>
        ) : null}
        {state.kind === "empty" ? (
          <div className="chat-selection-image__status">No image found</div>
        ) : null}
        {state.kind === "error" ? (
          <div className="chat-selection-image__status">
            {state.message.includes("Tavily API key")
              ? `Add a Tavily key in ${settingsSection("Data")}`
              : state.message}
          </div>
        ) : null}
        {state.kind === "imgError" ? (
          <div className="chat-selection-image__status">Couldn’t load image</div>
        ) : null}
        {state.kind === "ready" ? (
          <img
            className="chat-selection-image__img"
            src={state.imageUrl}
            alt={state.description || queryLabel}
            referrerPolicy="no-referrer"
            onError={() =>
              setState({
                kind: "imgError",
                query: state.query,
                imageUrl: state.imageUrl,
                description: state.description,
              })
            }
          />
        ) : null}
      </div>
      <div className="chat-selection-image__footer" title={queryLabel ? `“${queryLabel}”` : undefined}>
        {queryLabel ? `“${queryLabel}”` : null}
      </div>
    </div>
  );
}
