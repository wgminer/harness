import { snapToGrid } from "../shared/grid";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, ListTodo, Square, SquareCheck, Trash2, X } from "lucide-react";
import type { TaskItem, TasksPayload } from "../shared/electronAPI";
import {
  mergeCustomTaskTags,
  normalizeTags,
  taskIsDone,
  taskTagsWithoutLegacyStatus,
  toggleCompletedTag,
} from "../shared/taskTags";
import { useScrolledHeader } from "./useScrolledHeader";
import { Modal } from "./Modal";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { TASK_COMPLETE_MS } from "../shared/motion";

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

function TaskRow({
  task: t,
  onToggleDone,
  onOpen,
  completing = false,
}: {
  task: TaskItem;
  onToggleDone: (t: TaskItem) => void;
  onOpen: (t: TaskItem) => void;
  completing?: boolean;
}) {
  const tags = normalizeTags(t.tags);
  const displayTags = taskTagsWithoutLegacyStatus(tags);
  const done = taskIsDone(tags);
  const dateAdded = formatDateAdded(t.createdAt);
  const timeAgo = formatTimeAgo(t.createdAt);
  return (
    <li
      className={`tasks-row-item${completing ? " tasks-row-item--completing" : ""}`}
      aria-hidden={completing || undefined}
    >
      <div className="tasks-row">
        <button
          type="button"
          className="tasks-row-check"
          onClick={() => onToggleDone(t)}
          aria-label={done ? "Mark as not done" : "Mark as done"}
          title={done ? "Mark as not done" : "Mark as done"}
          disabled={completing}
        >
          {done ? (
            <SquareCheck size={20} strokeWidth={2} className="tasks-check-icon tasks-check-icon--on" />
          ) : (
            <Square size={20} strokeWidth={2} className="tasks-check-icon" />
          )}
        </button>
        <button
          type="button"
          className="tasks-row-body"
          onClick={() => onOpen(t)}
          disabled={completing}
        >
          <div className={`tasks-row-title ${done ? "tasks-row-title--done" : ""}`}>{t.title}</div>
          {dateAdded ? (
            <div className={`tasks-row-subtext ${done ? "tasks-row-subtext--done" : ""}`}>
              <span className="tasks-row-subtext-default">{dateAdded}</span>
              {timeAgo ? <span className="tasks-row-subtext-hover">{timeAgo}</span> : null}
            </div>
          ) : null}
          <TagChips tags={displayTags} className="tasks-row-tags" />
        </button>
      </div>
    </li>
  );
}

export function TasksView() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [modalTask, setModalTask] = useState<TaskItem | null>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalTags, setModalTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [modalSaving, setModalSaving] = useState(false);
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();
  const newTaskInputRef = useRef<HTMLTextAreaElement>(null);
  const tagFieldRef = useRef<HTMLInputElement>(null);
  const [activeOpen, setActiveOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [completingIds, setCompletingIds] = useState<Set<string>>(() => new Set());
  const completionTimeoutsRef = useRef<Map<string, number>>(new Map());
  const tasksPaneRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      newTaskInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const timeouts = completionTimeoutsRef.current;
    return () => {
      for (const handle of timeouts.values()) {
        window.clearTimeout(handle);
      }
      timeouts.clear();
    };
  }, []);

  const adjustNewTaskInputHeight = useCallback(() => {
    const el = newTaskInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustNewTaskInputHeight();
  }, [newTitle, adjustNewTaskInputHeight]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const payload = await window.electron.tasks.list();
        setTasks(payload.tasks ?? []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useLayoutEffect(() => {
    const pane = tasksPaneRef.current;
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

  const refreshFromPayload = (payload: unknown) => {
    const p = payload as Partial<TasksPayload> | null;
    if (p && Array.isArray(p.tasks)) {
      setTasks(p.tasks);
    }
  };

  const createTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      const payload = await window.electron.tasks.create(title, []);
      refreshFromPayload(payload);
      setNewTitle("");
    } finally {
      setCreating(false);
    }
  };

  const updateTaskTags = async (id: string, tags: string[]) => {
    const payload = await window.electron.tasks.update({ id, tags });
    refreshFromPayload(payload);
  };

  const deleteTask = async (id: string) => {
    const payload = await window.electron.tasks.delete(id);
    refreshFromPayload(payload);
  };

  const toggleDone = (t: TaskItem) => {
    const wasDone = taskIsDone(normalizeTags(t.tags));
    if (wasDone) {
      void updateTaskTags(t.id, toggleCompletedTag(t.tags));
      return;
    }
    if (completingIds.has(t.id)) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      void updateTaskTags(t.id, toggleCompletedTag(t.tags));
      return;
    }

    setCompletingIds((prev) => {
      const next = new Set(prev);
      next.add(t.id);
      return next;
    });

    const handle = window.setTimeout(() => {
      completionTimeoutsRef.current.delete(t.id);
      void updateTaskTags(t.id, toggleCompletedTag(t.tags));
      setCompletingIds((prev) => {
        if (!prev.has(t.id)) return prev;
        const next = new Set(prev);
        next.delete(t.id);
        return next;
      });
    }, TASK_COMPLETE_MS);
    completionTimeoutsRef.current.set(t.id, handle);
  };

  const openModal = (t: TaskItem) => {
    setModalTask(t);
    setModalTitle(t.title);
    setModalTags(taskTagsWithoutLegacyStatus(t.tags));
    setTagInput("");
    requestAnimationFrame(() => tagFieldRef.current?.focus());
  };

  const closeModal = useCallback(() => {
    if (modalSaving) return;
    setModalTask(null);
  }, [modalSaving]);

  useEffect(() => {
    if (!modalTask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalTask, closeModal]);

  const addModalTagFromInput = () => {
    const next = normalizeTags([tagInput]);
    if (next.length === 0) {
      setTagInput("");
      return;
    }
    const merged = normalizeTags([...modalTags, ...next]);
    setModalTags(merged);
    setTagInput("");
  };

  const removeModalTag = (tag: string) => {
    setModalTags(modalTags.filter((x) => x !== tag));
  };

  const saveModal = async () => {
    if (!modalTask) return;
    const trimmed = modalTitle.trim();
    if (!trimmed) return;
    setModalSaving(true);
    try {
      const tags = mergeCustomTaskTags(modalTask.tags, modalTags);
      const payload = await window.electron.tasks.update({
        id: modalTask.id,
        title: trimmed,
        tags,
      });
      refreshFromPayload(payload);
      setModalTask(null);
    } finally {
      setModalSaving(false);
    }
  };

  const deleteFromModal = async () => {
    if (!modalTask) return;
    setModalSaving(true);
    try {
      await deleteTask(modalTask.id);
      setModalTask(null);
    } finally {
      setModalSaving(false);
    }
  };

  const activeTasks = tasks.filter((t) => !taskIsDone(normalizeTags(t.tags)));
  const completedTasks = tasks.filter((t) => taskIsDone(normalizeTags(t.tags)));

  return (
    <div ref={tasksPaneRef} className="workspace-page tasks-page">
      <WorkspaceHeader title="Tasks" icon={<ListTodo size={18} />} scrolled={headerScrolled} />
      <div ref={scrollRef} className="workspace-scroll tasks-scroll" onScroll={onScroll}>
        <div className="workspace-content tasks-content">
          <div className="tasks-section">
            <button
              type="button"
              className="tasks-section-heading"
              aria-expanded={activeOpen}
              aria-controls="tasks-active-panel"
              id="tasks-active-heading"
              onClick={() => setActiveOpen((o) => !o)}
            >
              <ChevronRight
                size={18}
                strokeWidth={2}
                className={`tasks-section-caret${activeOpen ? " tasks-section-caret--open" : ""}`}
                aria-hidden
              />
              <span>Active</span>
            </button>
            <div id="tasks-active-panel" role="region" aria-labelledby="tasks-active-heading" hidden={!activeOpen}>
              {loading ? (
                <p className="tasks-section-lead">Loading tasks…</p>
              ) : activeTasks.length === 0 ? (
                <p className="tasks-section-lead">
                  {tasks.length === 0 ? "No tasks yet." : "No active tasks."}
                </p>
              ) : (
                <ul className="tasks-list">
                  {activeTasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      onToggleDone={toggleDone}
                      onOpen={openModal}
                      completing={completingIds.has(t.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>

          {completedTasks.length > 0 && (
            <div className="tasks-group">
              <button
                type="button"
                className="tasks-section-heading"
                aria-expanded={completedOpen}
                aria-controls="tasks-completed-panel"
                id="tasks-completed-heading"
                onClick={() => setCompletedOpen((o) => !o)}
              >
                <ChevronRight
                  size={18}
                  strokeWidth={2}
                  className={`tasks-section-caret${completedOpen ? " tasks-section-caret--open" : ""}`}
                  aria-hidden
                />
                <span>Completed</span>
              </button>
              <div
                id="tasks-completed-panel"
                role="region"
                aria-labelledby="tasks-completed-heading"
                hidden={!completedOpen}
              >
                <ul className="tasks-list">
                  {completedTasks.map((t) => (
                    <TaskRow key={t.id} task={t} onToggleDone={toggleDone} onOpen={openModal} />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <div ref={composerRef} className="tasks-composer-dock" data-testid="tasks-composer">
        <div className="chat-composer-inner">
          <textarea
            ref={newTaskInputRef}
            id="tasks-new-input"
            className="chat-input"
            aria-label="New task"
            placeholder="Describe the task…"
            rows={1}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void createTask();
              }
            }}
          />
          <div className="input-actions">
            <button
              type="button"
              className="btn chat-pane-btn"
              onClick={() => void createTask()}
              disabled={creating || !newTitle.trim()}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={modalTask != null}
        onClose={closeModal}
        title="Edit task"
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
                disabled={modalSaving || !modalTitle.trim()}
              >
                {modalSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        }
      >
        <label htmlFor="tasks-modal-title-input">Title</label>
        <textarea
          id="tasks-modal-title-input"
          className="tasks-textarea tasks-textarea--modal"
          rows={5}
          value={modalTitle}
          onChange={(e) => setModalTitle(e.target.value)}
        />
        <label htmlFor="tasks-modal-tags-input">Tags</label>
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
            id="tasks-modal-tags-input"
            type="text"
            className="tasks-tags-input"
            value={tagInput}
            placeholder="e.g. in progress, urgent"
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
