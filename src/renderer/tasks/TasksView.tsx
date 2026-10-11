import { snapToGrid } from "../../shared/grid";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronRight,
  Circle,
  CircleCheck,
  ListTree,
  LoaderCircle,
  Trash2,
  X,
} from "lucide-react";
import type { TaskItem, TasksPayload } from "../../shared/desktopAPI";
import { normalizeTags } from "../../shared/tags";
import {
  migrateTaskFields,
  resolveTaskStatus,
  taskIsDone,
  toggleTaskCompleted,
  type TaskStatus,
} from "../../shared/taskStatus";
import { buildTaskTree, NOW_LIMIT, sectionOf, type TaskSectionId } from "./taskTree";
import { Modal } from "../ui/Modal";
import { WorkspaceHeader } from "../ui/WorkspaceHeader";
import { WorkspaceListSearch } from "../ui/WorkspaceListSearch";
import { TASK_COMPLETE_HOLD_MS, TASK_COMPLETE_EXIT_MS } from "../../shared/motion";
import { ChatComposer } from "../chat/ChatComposer";
import { useChatComposer } from "../chat/useChatComposer";
import type { TakeLanding } from "../recording/dictationTake";

function CheckButton({
  done,
  onClick,
  disabled,
  size = 20,
}: {
  done: boolean;
  onClick: () => void;
  disabled?: boolean;
  size?: number;
}) {
  return (
    <button
      type="button"
      className="tasks-row-check"
      onClick={onClick}
      aria-label={done ? "Mark as not done" : "Mark as done"}
      title={done ? "Mark as not done" : "Mark as done"}
      disabled={disabled}
    >
      {done ? (
        <CircleCheck size={size} strokeWidth={2} className="tasks-check-icon tasks-check-icon--on" />
      ) : (
        <Circle size={size} strokeWidth={2} className="tasks-check-icon" />
      )}
    </button>
  );
}

function SubtaskRow({
  task: t,
  onToggleDone,
  onOpen,
}: {
  task: TaskItem;
  onToggleDone: (t: TaskItem) => void;
  onOpen: (t: TaskItem) => void;
}) {
  const done = taskIsDone(resolveTaskStatus(t));
  return (
    <li className="tasks-subtask">
      <div className="tasks-row tasks-row--sub">
        <CheckButton done={done} onClick={() => onToggleDone(t)} size={16} />
        <button type="button" className="tasks-row-body" onClick={() => onOpen(t)}>
          <div className={`tasks-row-title ${done ? "tasks-row-title--done" : ""}`}>{t.title}</div>
        </button>
      </div>
    </li>
  );
}

function TaskRow({
  task: t,
  subtasks = [],
  onToggleDone,
  onOpen,
  onToggleNow,
  onBreakdown,
  onDragStart,
  completing = false,
  dismissing = false,
  dragging = false,
  breakingDown = false,
}: {
  task: TaskItem;
  subtasks?: TaskItem[];
  onToggleDone: (t: TaskItem) => void;
  onOpen: (t: TaskItem) => void;
  onToggleNow: (t: TaskItem) => void;
  onBreakdown: (t: TaskItem) => void;
  onDragStart: (t: TaskItem, e: ReactPointerEvent<HTMLDivElement>) => void;
  completing?: boolean;
  dismissing?: boolean;
  dragging?: boolean;
  breakingDown?: boolean;
}) {
  const status = resolveTaskStatus(t);
  const done = taskIsDone(status) || completing;
  const section = sectionOf(t);
  const open = section !== "completed" && !completing;
  const inNow = section === "now";
  const phaseClass = dismissing
    ? " tasks-row-item--completing tasks-row-item--dismissing"
    : completing
      ? " tasks-row-item--completing"
      : "";
  const onBodyKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      onToggleNow(t);
    }
  };
  return (
    <li
      className={`tasks-row-item${phaseClass}${dragging ? " tasks-row-item--dragging" : ""}`}
      aria-hidden={dismissing || undefined}
    >
      <div className="tasks-row-stack">
        <div className="tasks-row" onPointerDown={open ? (e) => onDragStart(t, e) : undefined}>
          <CheckButton done={done} onClick={() => onToggleDone(t)} disabled={dismissing} />
          <button
            type="button"
            className="tasks-row-body"
            onClick={() => onOpen(t)}
            onKeyDown={onBodyKeyDown}
            disabled={completing}
            title={open ? (inNow ? "Press N to move back" : "Press N to move to Now") : undefined}
          >
            <div className={`tasks-row-title ${done ? "tasks-row-title--done" : ""}`}>{t.title}</div>
          </button>
          {open && (
            <div className="tasks-row-actions">
              <button
                type="button"
                className="btn btn-ghost btn-icon-sm tasks-row-action"
                onClick={() => onBreakdown(t)}
                disabled={breakingDown}
                aria-label="Break into subtasks"
                title="Break into subtasks"
              >
                {breakingDown ? (
                  <LoaderCircle size={14} strokeWidth={2} className="tasks-row-action-spin" aria-hidden />
                ) : (
                  <ListTree size={14} strokeWidth={2} aria-hidden />
                )}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon-sm tasks-row-action"
                onClick={() => onToggleNow(t)}
                aria-label={inNow ? "Move back to Active" : "Move to Now"}
                title={inNow ? "Move back to Active (N)" : "Move to Now (N)"}
              >
                {inNow ? (
                  <ArrowDownToLine size={14} strokeWidth={2} aria-hidden />
                ) : (
                  <ArrowUpToLine size={14} strokeWidth={2} aria-hidden />
                )}
              </button>
            </div>
          )}
        </div>
        {subtasks.length > 0 && (
          <ul className="tasks-subtasks">
            {subtasks.map((c) => (
              <SubtaskRow key={c.id} task={c} onToggleDone={onToggleDone} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const TASKS_VOICE_LANDING: TakeLanding = { surface: "tasks" };

export function TasksView() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalTask, setModalTask] = useState<TaskItem | null>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalTags, setModalTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [modalSaving, setModalSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const tagFieldRef = useRef<HTMLInputElement>(null);
  const [activeOpen, setActiveOpen] = useState(true);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [completingIds, setCompletingIds] = useState<Set<string>>(() => new Set());
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(() => new Set());
  const completionTimeoutsRef = useRef<Map<string, number>>(new Map());
  const tasksPaneRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [breakingDownId, setBreakingDownId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    title: string;
    x: number;
    y: number;
    over: TaskSectionId | null;
  } | null>(null);
  const suppressClickRef = useRef(false);

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
    voiceLanding: TASKS_VOICE_LANDING,
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
    // Subtasks stay under their parent when checked, so there is nothing to animate out.
    const isSubtask = t.parentId != null && tasks.some((x) => x.id === t.parentId);
    if (wasDone || isSubtask) {
      void patchTask(t.id, { status: toggleTaskCompleted(status) });
      return;
    }

    // Undo during hold (before the row exits).
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
      // Cancelled during hold — skip the exit.
      if (!completionTimeoutsRef.current.has(t.id)) return;
      setDismissingIds((prev) => {
        const next = new Set(prev);
        next.add(t.id);
        return next;
      });
      const exitHandle = window.setTimeout(finish, TASK_COMPLETE_EXIT_MS);
      completionTimeoutsRef.current.set(t.id, exitHandle);
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

  const tree = useMemo(() => buildTaskTree(tasks, searchQuery), [tasks, searchQuery]);
  const nowCount = useMemo(() => buildTaskTree(tasks).now.length, [tasks]);
  const searching = searchQuery.trim().length > 0;
  const showCompletedExpanded = searching ? true : completedOpen;

  useEffect(() => {
    if (!notice) return;
    const handle = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(handle);
  }, [notice]);

  const moveTo = useCallback(
    async (t: TaskItem, section: TaskSectionId) => {
      if (section === "completed" || sectionOf(t) === section) return;
      if (section === "now" && nowCount >= NOW_LIMIT) {
        setNotice(`Now holds ${NOW_LIMIT} tasks. Finish one or move it back first.`);
        return;
      }
      setNotice(null);
      const payload = await window.harness.tasks.update({
        id: t.id,
        status: section === "now" ? "in_progress" : "pending",
      });
      refreshFromPayload(payload);
    },
    [nowCount, refreshFromPayload],
  );

  const toggleNow = (t: TaskItem) => {
    void moveTo(t, sectionOf(t) === "now" ? "active" : "now");
  };

  const breakDown = async (t: TaskItem) => {
    if (breakingDownId) return;
    setBreakingDownId(t.id);
    setNotice(null);
    try {
      const payload = await window.harness.tasks.breakdown(t.id);
      if (payload.error) setNotice(payload.error);
      refreshFromPayload(payload);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBreakingDownId(null);
    }
  };

  /** Pointer drag (not HTML5 DnD, which the native window can intercept) between Now and Active. */
  const beginDrag = (t: TaskItem, e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".tasks-row-check, .tasks-row-action")) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    const dropAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-task-drop]")?.dataset.taskDrop as
        | TaskSectionId
        | undefined) ?? null;
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
    const onMove = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      active = true;
      ev.preventDefault();
      setDrag({ id: t.id, title: t.title, x: ev.clientX, y: ev.clientY, over: dropAt(ev.clientX, ev.clientY) });
    };
    const onUp = (ev: PointerEvent) => {
      cleanup();
      if (!active) return;
      // The click that follows pointerup must not open the editor.
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      setDrag(null);
      const target = dropAt(ev.clientX, ev.clientY);
      if (target) void moveTo(t, target);
    };
    const onCancel = () => {
      cleanup();
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const openFromRow = (t: TaskItem) => {
    if (suppressClickRef.current) return;
    openModal(t);
  };

  const renderRows = (items: TaskItem[], animate: boolean) => (
    <ul className="tasks-list">
      {items.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          subtasks={tree.children.get(t.id)}
          onToggleDone={toggleDone}
          onOpen={openFromRow}
          onToggleNow={toggleNow}
          onBreakdown={(task) => void breakDown(task)}
          onDragStart={beginDrag}
          completing={animate && completingIds.has(t.id)}
          dismissing={animate && dismissingIds.has(t.id)}
          dragging={drag?.id === t.id}
          breakingDown={breakingDownId === t.id}
        />
      ))}
    </ul>
  );

  const dropClass = (section: TaskSectionId) =>
    `tasks-drop${drag ? " tasks-drop--armed" : ""}${drag?.over === section ? " tasks-drop--over" : ""}`;

  return (
    <div ref={tasksPaneRef} className={`workspace-page tasks-page${drag ? " tasks-page--dragging" : ""}`}>
      <div className="workspace-scroll tasks-scroll">
        <WorkspaceHeader title="Tasks" className="tasks-header">
          <WorkspaceListSearch
            className="workspace-list-search--compact tasks-search"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search tasks…"
            aria-label="Search tasks"
          />
        </WorkspaceHeader>
        <div className="workspace-content workspace-stack tasks-content">
          {notice && (
            <p className="tasks-notice" role="status">
              {notice}
            </p>
          )}
          <div className={`tasks-section tasks-section--now ${dropClass("now")}`} data-task-drop="now">
            <div className="tasks-section-heading tasks-section-heading--static" id="tasks-now-heading">
              <span>Now</span>
              {!loading && (
                <span className="tasks-section-count">
                  {tree.now.length}/{NOW_LIMIT}
                </span>
              )}
            </div>
            <div role="region" aria-labelledby="tasks-now-heading">
              {loading ? null : tree.now.length === 0 ? (
                <p className="tasks-section-lead tasks-now-empty">
                  {searching ? "Nothing in Now matches." : "Drag a task here, or press N on one, to focus on it."}
                </p>
              ) : (
                renderRows(tree.now, true)
              )}
            </div>
          </div>
          <div className={`tasks-section ${dropClass("active")}`} data-task-drop="active">
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
              {!loading && <span className="tasks-section-count">{tree.active.length}</span>}
            </button>
            <div id="tasks-active-panel" role="region" aria-labelledby="tasks-active-heading" hidden={!activeOpen}>
              {loading ? (
                <p className="tasks-section-lead">Loading tasks…</p>
              ) : tree.active.length === 0 ? (
                <p className="tasks-section-lead">
                  {tasks.length === 0
                    ? "No tasks yet."
                    : searching
                      ? "No active tasks match your search."
                      : "No active tasks."}
                </p>
              ) : (
                renderRows(tree.active, true)
              )}
            </div>
          </div>

          {tree.completed.length > 0 && (
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
                <span className="tasks-section-count">{tree.completed.length}</span>
              </button>
              <div
                id="tasks-completed-panel"
                role="region"
                aria-labelledby="tasks-completed-heading"
                hidden={!showCompletedExpanded}
              >
                {renderRows(tree.completed, false)}
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
          onAttachmentError={(message) => {
            composer.setAttachmentError(message);
          }}
          inputRef={composer.inputRef}
          placeholder="Add a task…"
        />
      </div>

      {drag && (
        <div className="tasks-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>
          {drag.title}
        </div>
      )}

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
