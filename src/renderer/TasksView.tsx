import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ListTodo, Square, SquareCheck, Trash2, X } from "lucide-react";
import { useScrolledHeader } from "./useScrolledHeader";

type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
}

interface TasksPayload {
  tasks: TaskItem[];
}

interface TasksViewProps {
  onBack: () => void;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

function statusLabel(s: TaskStatus): string {
  return STATUS_LABEL[s] ?? s;
}

function TaskRow({
  task: t,
  onToggleDone,
  onOpen,
}: {
  task: TaskItem;
  onToggleDone: (t: TaskItem) => void;
  onOpen: (t: TaskItem) => void;
}) {
  const done = t.status === "completed";
  return (
    <li className="tasks-row">
      <button
        type="button"
        className="tasks-row-check"
        onClick={() => onToggleDone(t)}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        title={done ? "Mark as not done" : "Mark as done"}
      >
        {done ? (
          <SquareCheck size={20} strokeWidth={2} className="tasks-check-icon tasks-check-icon--on" />
        ) : (
          <Square size={20} strokeWidth={2} className="tasks-check-icon" />
        )}
      </button>
      <button type="button" className="tasks-row-body" onClick={() => onOpen(t)}>
        <div className={`tasks-row-title ${done ? "tasks-row-title--done" : ""}`}>{t.title}</div>
        <div className="tasks-row-meta">
          <span className="tasks-status-pill">{statusLabel(t.status)}</span>
        </div>
      </button>
    </li>
  );
}

export function TasksView({ onBack }: TasksViewProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [modalTask, setModalTask] = useState<TaskItem | null>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalStatus, setModalStatus] = useState<TaskStatus>("pending");
  const [modalSaving, setModalSaving] = useState(false);
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const payload = (await window.electron.tasks.list()) as TasksPayload;
        setTasks(payload.tasks ?? []);
      } finally {
        setLoading(false);
      }
    })();
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
      const payload = await window.electron.tasks.create(title, "pending");
      refreshFromPayload(payload);
      setNewTitle("");
    } finally {
      setCreating(false);
    }
  };

  const updateTaskStatus = async (id: string, status: TaskStatus) => {
    const payload = await window.electron.tasks.update({ id, status });
    refreshFromPayload(payload);
  };

  const deleteTask = async (id: string) => {
    const payload = await window.electron.tasks.delete(id);
    refreshFromPayload(payload);
  };

  const toggleDone = (t: TaskItem) => {
    if (t.status === "completed") {
      void updateTaskStatus(t.id, "pending");
    } else {
      void updateTaskStatus(t.id, "completed");
    }
  };

  const openModal = (t: TaskItem) => {
    setModalTask(t);
    setModalTitle(t.title);
    setModalStatus(t.status);
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

  const saveModal = async () => {
    if (!modalTask) return;
    const trimmed = modalTitle.trim();
    if (!trimmed) return;
    setModalSaving(true);
    try {
      const payload = await window.electron.tasks.update({
        id: modalTask.id,
        title: trimmed,
        status: modalStatus,
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

  const activeTasks = tasks.filter((t) => t.status !== "completed");
  const completedTasks = tasks.filter((t) => t.status === "completed");

  return (
    <div className="settings-page">
      <header className={`settings-header ${headerScrolled ? "settings-header--scrolled" : ""}`}>
        <button type="button" className="settings-back-btn btn" onClick={onBack}>
          <ArrowLeft size={18} />
          <span className="settings-back-label">Back</span>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ListTodo size={18} />
          <h2 className="settings-title">Tasks</h2>
        </div>
      </header>
      <div ref={scrollRef} className="settings-scroll" onScroll={onScroll}>
        <div className="settings-content">
          <div className="settings-section">
            <label htmlFor="tasks-new-input">New task</label>
            <div className="tasks-new-row">
              <textarea
                id="tasks-new-input"
                className="tasks-textarea"
                placeholder="Describe the task…"
                rows={3}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void createTask();
                  }
                }}
              />
              <button
                type="button"
                className="btn tasks-new-add"
                onClick={() => void createTask()}
                disabled={creating || !newTitle.trim()}
              >
                Add
              </button>
            </div>
            <p className="tasks-hint">⌘/Ctrl+Enter to add</p>
          </div>

          <div className="settings-section">
            <h3 className="settings-group__title">Active</h3>
            {loading ? (
              <p className="tasks-section-lead">Loading tasks…</p>
            ) : activeTasks.length === 0 ? (
              <p className="tasks-section-lead">
                {tasks.length === 0 ? "No tasks yet." : "No active tasks."}
              </p>
            ) : (
              <ul className="tasks-list">
                {activeTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onToggleDone={toggleDone} onOpen={openModal} />
                ))}
              </ul>
            )}
          </div>

          {completedTasks.length > 0 && (
            <div className="settings-group">
              <h3 className="settings-group__title">Completed</h3>
              <ul className="tasks-list">
                {completedTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onToggleDone={toggleDone} onOpen={openModal} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {modalTask && (
        <div
          className="tasks-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="tasks-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tasks-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tasks-modal-header">
              <h3 id="tasks-modal-title" className="tasks-modal-heading">
                Edit task
              </h3>
              <button
                type="button"
                className="btn btn-icon tasks-modal-close"
                onClick={closeModal}
                disabled={modalSaving}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="tasks-modal-body">
              <label htmlFor="tasks-modal-title-input">Title</label>
              <textarea
                id="tasks-modal-title-input"
                className="tasks-textarea tasks-textarea--modal"
                rows={5}
                value={modalTitle}
                onChange={(e) => setModalTitle(e.target.value)}
              />
              <label htmlFor="tasks-modal-status">Status</label>
              <select
                id="tasks-modal-status"
                value={modalStatus}
                onChange={(e) => setModalStatus(e.target.value as TaskStatus)}
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="tasks-modal-footer">
              <button
                type="button"
                className="btn btn-cancel"
                onClick={() => void deleteFromModal()}
                disabled={modalSaving}
              >
                <Trash2 size={14} />
                Delete
              </button>
              <div className="tasks-modal-footer-actions">
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
