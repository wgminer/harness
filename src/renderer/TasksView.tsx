import { snapToGrid } from "../shared/grid";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Circle, CircleCheck, ListTodo, Trash2, X } from "lucide-react";
import type { TaskItem, TasksPayload } from "../shared/desktopAPI";
import { normalizeTags } from "../shared/tags";
import {
  migrateTaskFields,
  resolveTaskStatus,
  taskIsActive,
  taskIsDone,
  taskIsInCompletedSection,
  toggleTaskCompleted,
  type TaskStatus,
} from "../shared/taskStatus";
import { useScrolledHeader } from "./useScrolledHeader";
import { Modal } from "./Modal";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceListSearch } from "./WorkspaceListSearch";
import { TASK_COMPLETE_HOLD_MS, TASK_COMPLETE_TV_MS } from "../shared/motion";
import { ChatComposer } from "./ChatComposer";
import { useChatComposer } from "./useChatComposer";

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
  dismissing = false,
}: {
  task: TaskItem;
  onToggleDone: (t: TaskItem) => void;
  onOpen: (t: TaskItem) => void;
  completing?: boolean;
  dismissing?: boolean;
}) {
  const displayTags = normalizeTags(t.tags);
  const status = resolveTaskStatus(t);
  const done = taskIsDone(status) || completing;
  const phaseClass = dismissing
    ? " tasks-row-item--completing tasks-row-item--dismissing"
    : completing
      ? " tasks-row-item--completing"
      : "";
  return (
    <li
      className={`tasks-row-item${phaseClass}`}
      aria-hidden={dismissing || undefined}
    >
      <div className="tasks-row">
        <button
          type="button"
          className="tasks-row-check"
          onClick={() => onToggleDone(t)}
          aria-label={done ? "Mark as not done" : "Mark as done"}
          title={done ? "Mark as not done" : "Mark as done"}
          disabled={dismissing}
        >
          {done ? (
            <CircleCheck size={20} strokeWidth={2} className="tasks-check-icon tasks-check-icon--on" />
          ) : (
            <Circle size={20} strokeWidth={2} className="tasks-check-icon" />
          )}
        </button>
        <button
          type="button"
          className="tasks-row-body"
          onClick={() => onOpen(t)}
          disabled={completing}
        >
          <div className={`tasks-row-title ${done ? "tasks-row-title--done" : ""}`}>{t.title}</div>
          <TagChips tags={displayTags} className="tasks-row-tags" />
        </button>
      </div>
    </li>
  );
}

export function TasksView() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalTask, setModalTask] = useState<TaskItem | null>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalTags, setModalTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [modalSaving, setModalSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();
  const tagFieldRef = useRef<HTMLInputElement>(null);
  const [activeOpen, setActiveOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [completingIds, setCompletingIds] = useState<Set<string>>(() => new Set());
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(() => new Set());
  const completionTimeoutsRef = useRef<Map<string, number>>(new Map());
  const tasksPaneRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const normalizeTask = useCallback((task: TaskItem): TaskItem => {
    const { status, tags } = migrateTaskFields(task as unknown as Record<string, unknown>);
    return { ...task, status, tags };
  }, []);

  const refreshFromPayload = useCallback((payload: unknown) => {
    const p = payload as Partial<TasksPayload> | null;
    if (p && Array.isArray(p.tasks)) {
      setTasks(p.tasks.map(normalizeTask));
    }
  }, [normalizeTask]);

  const composer = useChatComposer({
    onSubmit: async (text) => {
      const payload = await window.harness.tasks.create(text, []);
      refreshFromPayload(payload);
    },
    composerRef,
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      composer.inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [composer.inputRef]);

  useEffect(() => {
    const timeouts = completionTimeoutsRef.current;
    return () => {
      for (const handle of timeouts.values()) {
        window.clearTimeout(handle);
      }
      timeouts.clear();
    };
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const payload = await window.harness.tasks.list();
        setTasks((payload.tasks ?? []).map(normalizeTask));
      } finally {
        setLoading(false);
      }
    })();
  }, [normalizeTask]);

  useLayoutEffect(() => {
    const pane = tasksPaneRef.current;
    const dock = composerRef.current;
    if (!pane || !dock) return;

    const sync = () => {
      const h = Math.ceil(dock.getBoundingClientRect().height);
      pane.style.setProperty("--chat-composer-dock-height", `${snapToGrid(h)}px`);
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

  const patchTask = async (
    id: string,
    patch: { title?: string; status?: TaskStatus; tags?: string[] },
  ) => {
    const payload = await window.harness.tasks.update({ id, ...patch });
    refreshFromPayload(payload);
  };

  const deleteTask = async (id: string) => {
    const payload = await window.harness.tasks.delete(id);
    refreshFromPayload(payload);
  };

  const toggleDone = (t: TaskItem) => {
    const status = resolveTaskStatus(t);
    const wasDone = taskIsDone(status);
    if (wasDone) {
      void patchTask(t.id, { status: toggleTaskCompleted(status) });
      return;
    }

    // Undo during hold (before TV-out).
    if (completingIds.has(t.id)) {
      if (dismissingIds.has(t.id)) return;
      const handle = completionTimeoutsRef.current.get(t.id);
      if (handle !== undefined) {
        window.clearTimeout(handle);
        completionTimeoutsRef.current.delete(t.id);
      }
      setCompletingIds((prev) => {
        if (!prev.has(t.id)) return prev;
        const next = new Set(prev);
        next.delete(t.id);
        return next;
      });
      return;
    }

    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      void patchTask(t.id, { status: toggleTaskCompleted(status) });
      return;
    }

    setCompletingIds((prev) => {
      const next = new Set(prev);
      next.add(t.id);
      return next;
    });

    const finish = () => {
      completionTimeoutsRef.current.delete(t.id);
      void patchTask(t.id, { status: toggleTaskCompleted(status) });
      setCompletingIds((prev) => {
        if (!prev.has(t.id)) return prev;
        const next = new Set(prev);
        next.delete(t.id);
        return next;
      });
      setDismissingIds((prev) => {
        if (!prev.has(t.id)) return prev;
        const next = new Set(prev);
        next.delete(t.id);
        return next;
      });
    };

    const holdHandle = window.setTimeout(() => {
      // Cancelled during hold — skip TV-out.
      if (!completionTimeoutsRef.current.has(t.id)) return;
      setDismissingIds((prev) => {
        const next = new Set(prev);
        next.add(t.id);
        return next;
      });
      const tvHandle = window.setTimeout(finish, TASK_COMPLETE_TV_MS);
      completionTimeoutsRef.current.set(t.id, tvHandle);
    }, TASK_COMPLETE_HOLD_MS);
    completionTimeoutsRef.current.set(t.id, holdHandle);
  };

  const openModal = (t: TaskItem) => {
    setModalTask(t);
    setModalTitle(t.title);
    setModalTags(normalizeTags(t.tags));
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
      const payload = await window.harness.tasks.update({
        id: modalTask.id,
        title: trimmed,
        tags: modalTags,
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

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return tasks;
    const tagQuery = q.replace(/\s+/g, "_");
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        normalizeTags(t.tags).some((tag) => tag.includes(tagQuery)),
    );
  }, [tasks, searchQuery]);

  const activeTasks = filteredTasks.filter((t) => taskIsActive(resolveTaskStatus(t)));
  const completedTasks = filteredTasks.filter((t) => taskIsInCompletedSection(resolveTaskStatus(t)));
  const searching = searchQuery.trim().length > 0;
  const showCompletedExpanded = searching ? true : completedOpen;

  return (
    <div ref={tasksPaneRef} className="workspace-page tasks-page">
      <WorkspaceHeader title="Tasks" icon={<ListTodo size={16} />} scrolled={headerScrolled} />
      <div ref={scrollRef} className="workspace-scroll tasks-scroll" onScroll={onScroll}>
        <div className="workspace-content workspace-stack tasks-content">
          <WorkspaceListSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search tasks…"
            aria-label="Search tasks"
          />
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
                  {tasks.length === 0
                    ? "No tasks yet."
                    : searching
                      ? "No active tasks match your search."
                      : "No active tasks."}
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
                      dismissing={dismissingIds.has(t.id)}
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
                aria-expanded={showCompletedExpanded}
                aria-controls="tasks-completed-panel"
                id="tasks-completed-heading"
                onClick={() => setCompletedOpen((o) => !o)}
              >
                <ChevronRight
                  size={18}
                  strokeWidth={2}
                  className={`tasks-section-caret${showCompletedExpanded ? " tasks-section-caret--open" : ""}`}
                  aria-hidden
                />
                <span>Completed</span>
              </button>
              <div
                id="tasks-completed-panel"
                role="region"
                aria-labelledby="tasks-completed-heading"
                hidden={!showCompletedExpanded}
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

      <div
        ref={composerRef}
        className="chat-composer-dock"
        data-testid="tasks-composer"
        role="group"
        aria-label="Task composer"
      >
        <ChatComposer
          input={composer.input}
          onInputChange={composer.setInput}
          onSend={() => void composer.send()}
          onStop={() => {}}
          sending={composer.composerBusy}
          voiceState={composer.voiceState}
          voiceError={composer.voiceError}
          recordingMs={composer.recordingMs}
          onStartRecording={() => void composer.startRecording()}
          onStopRecording={() => void composer.stopAndTranscribe()}
          onCancelRecording={() => void composer.cancelRecording()}
          attachedAudioName={composer.attachedAudioFile?.name ?? null}
          attachmentTranscribing={composer.attachmentTranscribing}
          attachmentError={composer.attachmentError}
          onAttachAudio={(file) => {
            composer.setAttachedAudioFile(file);
            composer.setAttachmentError(null);
          }}
          onRemoveAttachedAudio={() => {
            composer.setAttachedAudioFile(null);
            composer.setAttachmentError(null);
          }}
          inputRef={composer.inputRef}
        />
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
              className="btn btn-danger"
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
        <div className="app-modal-stack">
          <label className="app-modal-field" htmlFor="tasks-modal-title-input">
            <span className="app-modal-field__label">Title</span>
            <textarea
              id="tasks-modal-title-input"
              className="app-modal-input app-modal-input--multiline tasks-modal-title-input"
              rows={5}
              value={modalTitle}
              onChange={(e) => setModalTitle(e.target.value)}
            />
          </label>
          <div className="app-modal-field">
            <label className="app-modal-field__label" htmlFor="tasks-modal-tags-input">
              Tags
            </label>
            <p className="app-modal-field__hint">Press Enter to add. Underscores show as spaces in the list.</p>
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
          </div>
        </div>
      </Modal>
    </div>
  );
}
