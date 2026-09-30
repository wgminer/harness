import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Image as ImageIcon, MessageCircle, Mic, Search, StickyNote } from "lucide-react";
import type { SearchResult } from "../../shared/types";
import { searchTitleOnly, tokenizeQuery } from "../../shared/conversationSearch";
import {
  conversationDisplayTitle,
  isSidebarVisibleConversation,
  type ConversationListRow,
} from "../../shared/conversationSession";
import { getDisplayNoteTitle, type NoteSummary } from "../../shared/writing";
import { getDisplayImageTitle, type GeneratedImage } from "../../shared/images";

const SEARCH_DEBOUNCE_MS = 120;
const RESULTS_PER_GROUP = 6;
const RECENT_LIMIT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
  conversations: ConversationListRow[];
  notes: NoteSummary[];
  images: GeneratedImage[];
  onSelectConversation: (id: string) => void;
  onSelectNote: (id: string) => void;
  onSelectImage: (id: string) => void;
}

type PaletteGroupKey = "chat" | "dictation" | "note" | "image";

interface PaletteItem {
  key: string;
  group: PaletteGroupKey;
  id: string;
  title: string;
  snippet?: string;
  at: number;
  meta: string[];
}

const ICON_PROPS = { size: 16, strokeWidth: 1.75 } as const;

const GROUP_ICONS: Record<PaletteGroupKey, ReactNode> = {
  chat: <MessageCircle {...ICON_PROPS} />,
  dictation: <Mic {...ICON_PROPS} />,
  note: <StickyNote {...ICON_PROPS} />,
  image: <ImageIcon {...ICON_PROPS} />,
};

const GROUPS: { key: PaletteGroupKey; label: string }[] = [
  { key: "chat", label: "Chats" },
  { key: "dictation", label: "Dictations" },
  { key: "note", label: "Notes" },
  { key: "image", label: "Images" },
];

/** Every occurrence of every query token, merged into non-overlapping ranges. */
function matchRanges(text: string, tokens: string[]): [number, number][] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const token of tokens) {
    let from = 0;
    for (let i = lower.indexOf(token, from); i >= 0; i = lower.indexOf(token, from)) {
      ranges.push([i, i + token.length]);
      from = i + token.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

function Highlighted({ text, tokens }: { text: string; tokens: string[] }) {
  const ranges = matchRanges(text, tokens);
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={start} className="search-highlight">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Today 3:42 PM / Yesterday 3:42 PM / Tue 3:42 PM / Sep 3 / Sep 3, 2024 */
function formatResultDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

function formatFullDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

function conversationItem(r: SearchResult, row: ConversationListRow | undefined): PaletteItem {
  const group = r.kind === "dictation" ? "dictation" : "chat";
  const meta = [group === "dictation" ? "Dictation" : row?.chatMode === "qa" ? "Q&A" : "Chat"];
  if (r.titleMatched) meta.push("Title match");
  const snippet = oneLine(r.snippet);
  return {
    key: `${r.kind}:${r.id}`,
    group,
    id: r.id,
    title: conversationDisplayTitle(r.title, r.createdAt),
    snippet: snippet && snippet !== "No message content" ? snippet : undefined,
    at: r.createdAt,
    meta,
  };
}

function conversationRowItem(row: ConversationListRow): PaletteItem {
  const group = row.sessionKind === "dictation" ? "dictation" : "chat";
  return {
    key: `${group}:${row.id}`,
    group,
    id: row.id,
    title: conversationDisplayTitle(row.title, row.createdAt),
    at: row.createdAt,
    meta: [group === "dictation" ? "Dictation" : row.chatMode === "qa" ? "Q&A" : "Chat"],
  };
}

function noteItem(note: NoteSummary): PaletteItem {
  return {
    key: `note:${note.id}`,
    group: "note",
    id: note.id,
    title: getDisplayNoteTitle(note.title),
    at: note.updatedAt,
    meta: ["Note", plural(note.wordCount, "word")],
  };
}

function imageItem(image: GeneratedImage): PaletteItem {
  const meta = ["Image"];
  if (image.versions.length > 1) meta.push(plural(image.versions.length, "version"));
  if (image.size !== "auto") meta.push(image.size.replace("x", "\u00d7"));
  const prompt = oneLine(image.prompt);
  return {
    key: `image:${image.id}`,
    group: "image",
    id: image.id,
    title: getDisplayImageTitle(image.title),
    snippet: prompt || undefined,
    at: image.updatedAt,
    meta,
  };
}

/** Cmd-K overlay: search-as-you-type across chats, dictations, notes, and images. */
export function SearchPalette({
  open,
  onClose,
  conversations,
  notes,
  images,
  onSelectConversation,
  onSelectNote,
  onSelectImage,
}: SearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [conversationResults, setConversationResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const uid = useId();
  const listboxId = `${uid}-listbox`;

  const trimmed = query.trim();
  const tokens = useMemo(() => tokenizeQuery(trimmed), [trimmed]);
  const hasTokens = tokens.length > 0;

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setConversationResults([]);
    setLoading(false);
    setActiveIndex(0);
    inputRef.current?.focus();
    return () => {
      requestSeqRef.current += 1;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!hasTokens) {
      requestSeqRef.current += 1;
      setConversationResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++requestSeqRef.current;
    const t = setTimeout(() => {
      window.harness.memory
        .searchConversations(trimmed, true)
        .then((results) => {
          if (seq !== requestSeqRef.current) return;
          setConversationResults(results);
          setLoading(false);
        })
        .catch(() => {
          if (seq !== requestSeqRef.current) return;
          setConversationResults([]);
          setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [open, trimmed, hasTokens]);

  const groups = useMemo((): { key: string; label: string; items: PaletteItem[] }[] => {
    if (!trimmed) {
      const recent = [
        ...conversations.filter(isSidebarVisibleConversation).map(conversationRowItem),
        ...notes.map(noteItem),
        ...images.map(imageItem),
      ]
        .sort((a, b) => b.at - a.at)
        .slice(0, RECENT_LIMIT);
      return recent.length > 0 ? [{ key: "recent", label: "Recent", items: recent }] : [];
    }
    if (!hasTokens) return [];
    const byGroup: Record<PaletteGroupKey, PaletteItem[]> = {
      chat: [],
      dictation: [],
      note: [],
      image: [],
    };
    const rowsById = new Map(conversations.map((c) => [c.id, c]));
    for (const r of conversationResults) {
      const item = conversationItem(r, rowsById.get(r.id));
      byGroup[item.group].push(item);
    }
    const notesById = new Map(notes.map((n) => [n.id, n]));
    byGroup.note = searchTitleOnly(
      notes.map((n) => ({ id: n.id, title: getDisplayNoteTitle(n.title), activityAt: n.updatedAt })),
      trimmed,
      "note",
    ).flatMap((r) => {
      const note = notesById.get(r.id);
      return note ? [noteItem(note)] : [];
    });
    const imagesById = new Map(images.map((img) => [img.id, img]));
    byGroup.image = searchTitleOnly(
      images.map((img) => ({ id: img.id, title: getDisplayImageTitle(img.title), activityAt: img.updatedAt })),
      trimmed,
      "image",
    ).flatMap((r) => {
      const image = imagesById.get(r.id);
      return image ? [imageItem(image)] : [];
    });

    return GROUPS.map((g) => ({ ...g, items: byGroup[g.key].slice(0, RESULTS_PER_GROUP) })).filter(
      (g) => g.items.length > 0,
    );
  }, [hasTokens, conversationResults, conversations, notes, images, trimmed]);

  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trimmed]);

  useEffect(() => {
    if (activeIndex >= flatItems.length && flatItems.length > 0) setActiveIndex(flatItems.length - 1);
  }, [activeIndex, flatItems.length]);

  const activeItem = flatItems[activeIndex];

  useEffect(() => {
    if (!activeItem) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeItem.key)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeItem]);

  if (!open) return null;

  const close = (restoreFocus: boolean) => {
    onClose();
    if (restoreFocus) restoreFocusRef.current?.focus?.();
  };

  const choose = (item: PaletteItem) => {
    close(false);
    if (item.group === "note") onSelectNote(item.id);
    else if (item.group === "image") onSelectImage(item.id);
    else onSelectConversation(item.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.nativeEvent.isComposing) return;
    const count = flatItems.length;
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      if (count === 0) return;
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % count);
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      if (count === 0) return;
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + count) % count);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeItem) choose(activeItem);
    }
  };

  let status: string | null = null;
  if (trimmed && !hasTokens) status = "Keep typing…";
  else if (hasTokens && flatItems.length === 0) status = loading ? "Searching…" : "No results";
  else if (!trimmed && flatItems.length === 0) status = "Nothing yet. Start a chat, note, or image to see it here.";

  let itemIndex = -1;

  return (
    <div
      className="search-palette-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(true);
      }}
    >
      <div
        className="search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onKeyDown={onKeyDown}
        data-testid="search-palette"
      >
        <div className="search-palette__input-row">
          <Search size={16} strokeWidth={2} className="search-palette__input-icon" aria-hidden />
          <input
            ref={inputRef}
            className="search-palette__input"
            placeholder="Search chats, notes, and images…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded={flatItems.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeItem ? `${uid}-${activeItem.key}` : undefined}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {flatItems.length > 0 ? (
          <div className="search-palette__results" id={listboxId} role="listbox" ref={listRef}>
            {groups.map((g) => (
              <div key={g.key} role="group" aria-labelledby={`${uid}-group-${g.key}`}>
                <div id={`${uid}-group-${g.key}`} className="search-palette__group-label">
                  {g.label}
                </div>
                {g.items.map((item) => {
                  itemIndex += 1;
                  const index = itemIndex;
                  const selected = index === activeIndex;
                  return (
                    <div
                      key={item.key}
                      id={`${uid}-${item.key}`}
                      data-key={item.key}
                      role="option"
                      aria-selected={selected}
                      className={`search-palette__item${selected ? " search-palette__item--active" : ""}`}
                      onMouseMove={() => {
                        if (!selected) setActiveIndex(index);
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(item)}
                    >
                      <span className="search-palette__item-icon" aria-hidden>
                        {GROUP_ICONS[item.group]}
                      </span>
                      <span className="search-palette__item-body">
                        <span className="search-palette__item-head">
                          <span className="search-palette__item-title">
                            <Highlighted text={item.title} tokens={tokens} />
                          </span>
                          <time
                            className="search-palette__item-date"
                            dateTime={new Date(item.at).toISOString()}
                            title={formatFullDate(item.at)}
                          >
                            {formatResultDate(item.at)}
                          </time>
                        </span>
                        {item.snippet ? (
                          <span className="search-palette__item-snippet">
                            <Highlighted text={item.snippet} tokens={tokens} />
                          </span>
                        ) : null}
                        <span className="search-palette__item-meta">{item.meta.join(" \u00b7 ")}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : status ? (
          <p className="search-palette__status">{status}</p>
        ) : null}

        <div className="search-palette__footer" aria-hidden>
          <span className="search-palette__hint">
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            Navigate
          </span>
          <span className="search-palette__hint">
            <kbd>↵</kbd>
            Open
          </span>
          <span className="search-palette__hint">
            <kbd>Esc</kbd>
            Close
          </span>
          {hasTokens && flatItems.length > 0 ? (
            <span className="search-palette__footer-count">{plural(flatItems.length, "result")}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
