import { snapToGrid } from "../shared/grid";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Clipboard, Copy, Trash2, X } from "lucide-react";
import type { ClippingItem, ClippingsPayload } from "../shared/electronAPI";
import { normalizeTags } from "../shared/tags";
import { useScrolledHeader } from "./useScrolledHeader";
import { Modal } from "./Modal";
import { WorkspaceHeader } from "./WorkspaceHeader";

const taskDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const taskRelativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatDateAdded(createdAt?: number): string | null {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return `Added ${taskDateFormatter.format(date)}`;
}

function formatTimeAgo(createdAt?: number): string | null {
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  const deltaMs = createdAt - Date.now();
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;
  const yearMs = 365 * dayMs;

  if (Math.abs(deltaMs) < hourMs) {
    const minutes = Math.round(deltaMs / minuteMs);
    return `Added ${taskRelativeTimeFormatter.format(minutes, "minute")}`;
  }
  if (Math.abs(deltaMs) < dayMs) {
    const hours = Math.round(deltaMs / hourMs);
    return `Added ${taskRelativeTimeFormatter.format(hours, "hour")}`;
  }
  if (Math.abs(deltaMs) < weekMs) {
    const days = Math.round(deltaMs / dayMs);
    return `Added ${taskRelativeTimeFormatter.format(days, "day")}`;
  }
  if (Math.abs(deltaMs) < yearMs) {
    const months = Math.round(deltaMs / monthMs);
    return `Added ${taskRelativeTimeFormatter.format(months, "month")}`;
  }
  const years = Math.round(deltaMs / yearMs);
  return `Added ${taskRelativeTimeFormatter.format(years, "year")}`;
}

function TagChips({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <div className={className}>
      {tags.map((tag) => (
        <span key={tag} className="tasks-tag">
          {tag.replace(/_/g, " ")}
        </span>
      ))}
    </div>
  );
}

function ClippingRow({
  clipping,
  copiedId,
  onOpen,
  onCopy,
}: {
  clipping: ClippingItem;
  copiedId: string | null;
  onOpen: (c: ClippingItem) => void;
  onCopy: (c: ClippingItem) => void;
}) {
  const tags = normalizeTags(clipping.tags);
  const dateAdded = formatDateAdded(clipping.createdAt);
  const timeAgo = formatTimeAgo(clipping.createdAt);
  const justCopied = copiedId === clipping.id;
  return (
    <li className="tasks-row-item">
      <div className="tasks-row">
        <button
          type="button"
          className="tasks-row-check"
          onClick={() => onCopy(clipping)}
          aria-label="Copy clipping"
          title="Copy"
        >
          <Copy size={20} strokeWidth={2} className="tasks-check-icon" />
        </button>
        <button type="button" className="tasks-row-body" onClick={() => onOpen(clipping)}>
          <div className="tasks-row-title">{clipping.content}</div>
          {dateAdded ? (
            <div className={`tasks-row-subtext${justCopied ? " tasks-row-subtext--copied" : ""}`}>
              {justCopied ? (
                <span className="tasks-row-subtext-default">Copied</span>
              ) : (
                <>
                  <span className="tasks-row-subtext-default">{dateAdded}</span>
                  {timeAgo ? <span className="tasks-row-subtext-hover">{timeAgo}</span> : null}
                </>
              )}
            </div>
          ) : null}
          <TagChips tags={tags} className="tasks-row-tags" />
        </button>
      </div>
    </li>
  );
}

export function ClippingsView() {
  const [clippings, setClippings] = useState<ClippingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [modalClipping, setModalClipping] = useState<ClippingItem | null>(null);
  const [modalContent, setModalContent] = useState("");
  const [modalTags, setModalTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [modalSaving, setModalSaving] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();
  const newInputRef = useRef<HTMLTextAreaElement>(null);
  const tagFieldRef = useRef<HTMLInputElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const loadGenerationRef = useRef(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      newInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const adjustInputHeight = useCallback(() => {
    const el = newInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustInputHeight();
  }, [newContent, adjustInputHeight]);

  const loadClippings = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    try {
      const payload = await window.electron.clippings.list();
      if (generation !== loadGenerationRef.current) return;
      setClippings(payload.clippings ?? []);
      setActionError(null);
    } catch (err) {
      if (generation === loadGenerationRef.current) {
        setActionError(err instanceof Error ? err.message : "Could not load clippings");
      }
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, []);

  const applyPayload = useCallback((payload: unknown) => {
    const p = payload as Partial<ClippingsPayload> | null;
    if (!p) return false;
    if (p.error) {
      setActionError(p.error);
      return false;
    }
    if (Array.isArray(p.clippings)) {
      setClippings(p.clippings);
      setActionError(null);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    void loadClippings();
  }, [loadClippings]);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    const dock = composerRef.current;
    if (!pane || !dock) return;

    const sync = () => {
      const h = Math.ceil(dock.getBoundingClientRect().height);
      pane.style.setProperty("--tasks-composer-dock-height", `${snapToGrid(h)}px`);
    };

    sync();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(sync);
      ro.observe(dock);
    }

    window.addEventListener("resize", sync);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);

  const allTags = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of clippings) {
      for (const tag of normalizeTags(c.tags)) {
        if (!seen.has(tag)) {
          seen.add(tag);
          out.push(tag);
        }
      }
    }
    return out.sort();
  }, [clippings]);

  const tagFilteredClippings = useMemo(() => {
    if (!activeTag) return clippings;
    return clippings.filter((c) => normalizeTags(c.tags).includes(activeTag));
  }, [clippings, activeTag]);

  const filteredClippings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tagFilteredClippings;
    return tagFilteredClippings.filter(
      (c) =>
        c.content.toLowerCase().includes(q) ||
        normalizeTags(c.tags).some((t) => t.includes(q.replace(/\s+/g, "_"))),
    );
  }, [tagFilteredClippings, searchQuery]);

  const createClipping = async () => {
    const content = newContent.trim();
    if (!content) return;
    setCreating(true);
    loadGenerationRef.current += 1;
    try {
      const payload = await window.electron.clippings.create(content, []);
      if (applyPayload(payload)) {
        setNewContent("");
        setLoading(false);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save clipping");
    } finally {
      setCreating(false);
    }
  };

  const copyClipping = async (c: ClippingItem) => {
    try {
      await navigator.clipboard.writeText(c.content);
      setCopiedId(c.id);
      setTimeout(() => setCopiedId((prev) => (prev === c.id ? null : prev)), 2000);
    } catch {
      /* ignore */
    }
  };

  const openModal = (c: ClippingItem) => {
    setModalClipping(c);
    setModalContent(c.content);
    setModalTags(normalizeTags(c.tags));
    setTagInput("");
    requestAnimationFrame(() => tagFieldRef.current?.focus());
  };

  const closeModal = useCallback(() => {
    if (modalSaving) return;
    setModalClipping(null);
  }, [modalSaving]);

  useEffect(() => {
    if (!modalClipping) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalClipping, closeModal]);

  const addModalTagFromInput = () => {
    const next = normalizeTags([tagInput]);
    if (next.length === 0) {
      setTagInput("");
      return;
    }
    setModalTags(normalizeTags([...modalTags, ...next]));
    setTagInput("");
  };

  const removeModalTag = (tag: string) => {
    setModalTags(modalTags.filter((x) => x !== tag));
  };

  const saveModal = async () => {
    if (!modalClipping) return;
    const trimmed = modalContent.trim();
    if (!trimmed) return;
    setModalSaving(true);
    loadGenerationRef.current += 1;
    try {
      const payload = await window.electron.clippings.update({
        id: modalClipping.id,
        content: trimmed,
        tags: modalTags,
      });
      if (applyPayload(payload)) {
        setModalClipping(null);
        setLoading(false);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update clipping");
    } finally {
      setModalSaving(false);
    }
  };

  const deleteFromModal = async () => {
    if (!modalClipping) return;
    setModalSaving(true);
    loadGenerationRef.current += 1;
    try {
      const payload = await window.electron.clippings.delete(modalClipping.id);
      if (applyPayload(payload)) {
        setModalClipping(null);
        setLoading(false);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not delete clipping");
    } finally {
      setModalSaving(false);
    }
  };

  return (
    <div ref={paneRef} className="workspace-page tasks-page" data-testid="clippings-view">
      <WorkspaceHeader title="Clippings" icon={<Clipboard size={18} />} scrolled={headerScrolled} />
      <div ref={scrollRef} className="workspace-scroll tasks-scroll" onScroll={onScroll}>
        <div className="workspace-content tasks-content">
          {actionError ? (
            <p className="tasks-section-lead tasks-section-lead--error" role="alert">
              {actionError}
            </p>
          ) : null}
          <input
            type="search"
            className="workspace-search-input"
            placeholder="Search clippings…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search clippings"
          />

          {allTags.length > 0 ? (
            <div className="clippings-filter-bar" role="group" aria-label="Filter by tag">
              <button
                type="button"
                className={`clippings-filter-chip${activeTag === null ? " active" : ""}`}
                onClick={() => setActiveTag(null)}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`clippings-filter-chip${activeTag === tag ? " active" : ""}`}
                  onClick={() => setActiveTag(tag)}
                >
                  {tag.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          ) : null}

          {loading && clippings.length === 0 ? (
            <p className="tasks-section-lead">Loading clippings…</p>
          ) : filteredClippings.length === 0 ? (
            <p className="tasks-section-lead">
              {clippings.length === 0 ? "No clippings yet." : "No clippings match your filter."}
            </p>
          ) : (
            <div className="tasks-section">
              <ul className="tasks-list">
                {filteredClippings.map((c) => (
                  <ClippingRow
                    key={c.id}
                    clipping={c}
                    copiedId={copiedId}
                    onOpen={openModal}
                    onCopy={copyClipping}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div ref={composerRef} className="tasks-composer-dock" data-testid="clippings-composer">
        <div className="chat-composer-inner">
          <textarea
            ref={newInputRef}
            id="clippings-new-input"
            className="chat-input"
            aria-label="New clipping"
            placeholder="Save a snippet…"
            rows={1}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void createClipping();
              }
            }}
          />
          <div className="input-actions">
            <button
              type="button"
              className="btn chat-pane-btn"
              onClick={() => void createClipping()}
              disabled={creating || !newContent.trim()}
            >
              Save
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={modalClipping != null}
        onClose={closeModal}
        title="Edit clipping"
        closeDisabled={modalSaving}
        variant="scrollable"
        footerClassName="app-modal-footer--spread"
        footer={
          <>
            <button
              type="button"
              className="btn btn-cancel"
              onClick={() => void deleteFromModal()}
              disabled={modalSaving}
            >
              <Trash2 size={14} />
              Delete
            </button>
            <div className="app-modal-footer-actions">
              <button type="button" className="btn" onClick={closeModal} disabled={modalSaving}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveModal()}
                disabled={modalSaving || !modalContent.trim()}
              >
                {modalSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        }
      >
        <label htmlFor="clippings-modal-content-input">Content</label>
        <textarea
          id="clippings-modal-content-input"
          className="tasks-textarea tasks-textarea--modal"
          rows={6}
          value={modalContent}
          onChange={(e) => setModalContent(e.target.value)}
        />
        <label htmlFor="clippings-modal-tags-input">Tags</label>
        <p className="tasks-modal-hint">Press Enter to add. Underscores show as spaces in the list.</p>
        <div className="tasks-tag-field">
          <div className="tasks-tag-editor">
            {modalTags.map((tag) => (
              <span key={tag} className="tasks-tag tasks-tag--editable">
                {tag.replace(/_/g, " ")}
                <button
                  type="button"
                  className="tasks-tag-remove"
                  onClick={() => removeModalTag(tag)}
                  disabled={modalSaving}
                  aria-label={`Remove tag ${tag}`}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
          <input
            ref={tagFieldRef}
            id="clippings-modal-tags-input"
            type="text"
            className="tasks-tags-input"
            value={tagInput}
            placeholder="e.g. quotes, research"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addModalTagFromInput();
              }
            }}
            disabled={modalSaving}
          />
        </div>
      </Modal>
    </div>
  );
}
