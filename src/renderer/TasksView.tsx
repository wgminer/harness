import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ListTodo, Trash2 } from "lucide-react";

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

export function TasksView({ onBack }: TasksViewProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [headerScrolled, setHeaderScrolled] = useState(false);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setHeaderScrolled(el.scrollTop > 12);
  };

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

  const updateTaskTitle = async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const payload = await window.electron.tasks.update({ id, title: trimmed });
    refreshFromPayload(payload);
  };

  const updateTaskStatus = async (id: string, status: TaskStatus) => {
    const payload = await window.electron.tasks.update({ id, status });
    refreshFromPayload(payload);
  };

  const deleteTask = async (id: string) => {
    const payload = await window.electron.tasks.delete(id);
    refreshFromPayload(payload);
  };

  const clearCompleted = async () => {
    const payload = await window.electron.tasks.clearCompleted();
    refreshFromPayload(payload);
  };

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
            <label>New task</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="Describe the task…"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    createTask();
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={createTask}
                disabled={creating || !newTitle.trim()}
              >
                Add
              </button>
            </div>
          </div>

          <div
            className="settings-section"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
          >
            <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>
              {loading
                ? "Loading tasks…"
                : tasks.length === 0
                ? "No tasks yet."
                : `${tasks.length} task${tasks.length !== 1 ? "s" : ""}`}
            </span>
            {tasks.some((t) => t.status === "completed" || t.status === "cancelled") && (
              <button type="button" className="btn" onClick={clearCompleted}>
                Clear done
              </button>
            )}
          </div>

          {tasks.length > 0 && (
            <div className="settings-section">
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ paddingBottom: 6 }}>Title</th>
                    <th style={{ paddingBottom: 6, width: 140 }}>Status</th>
                    <th style={{ paddingBottom: 6, width: 40 }} aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id}>
                      <td style={{ padding: "4px 0" }}>
                        <input
                          type="text"
                          defaultValue={t.title}
                          onBlur={(e) => {
                            if (e.target.value !== t.title) {
                              updateTaskTitle(t.id, e.target.value);
                            }
                          }}
                          style={{ width: "100%" }}
                        />
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <select
                          value={t.status}
                          onChange={(e) => updateTaskStatus(t.id, e.target.value as TaskStatus)}
                          style={{ width: "100%" }}
                        >
                          <option value="pending">Pending</option>
                          <option value="in_progress">In progress</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </td>
                      <td style={{ padding: "4px 0", textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn btn-icon"
                          onClick={() => deleteTask(t.id)}
                          title="Delete task"
                          aria-label="Delete task"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

