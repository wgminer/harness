import { useState, useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";

interface Settings {
  version: number;
  activeProvider: string;
  openai?: { apiKey: string; model: string };
}

interface SettingsViewProps {
  onBack: () => void;
  onImportComplete?: () => void;
}

const SAVE_DEBOUNCE_MS = 500;

export function SettingsView({ onBack, onImportComplete }: SettingsViewProps) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-5.2");

  const OPENAI_MODELS = [
    { value: "gpt-5.3-codex", label: "Coding" },
    { value: "gpt-5.2", label: "General" },
    { value: "gpt-5-mini", label: "Fast & cheap" },
  ];
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [userMemory, setUserMemory] = useState<Record<string, string>>({});
  const [newMemKey, setNewMemKey] = useState("");
  const [newMemVal, setNewMemVal] = useState("");
  const [importStatus, setImportStatus] = useState<{ imported: number; errors: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const skipNextSaveRef = useRef(true);
  const hideToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [headerScrolled, setHeaderScrolled] = useState(false);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setHeaderScrolled(el.scrollTop > 12);
  };

  useEffect(() => {
    window.electron.settings.get().then((s) => {
      const S = s as Settings;
      setApiKey(S.openai?.apiKey ?? "");
      setModel(S.openai?.model ?? "gpt-5.2");
    });
    window.electron.memory.getUserMemory().then(setUserMemory);
  }, []);

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      await window.electron.settings.set({
        openai: { apiKey, model },
      });
      setSaveStatus("saved");
      if (hideToastRef.current) clearTimeout(hideToastRef.current);
      hideToastRef.current = setTimeout(() => {
        setSaveStatus("idle");
        hideToastRef.current = null;
      }, 1500);
    }, SAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      if (hideToastRef.current) {
        clearTimeout(hideToastRef.current);
        hideToastRef.current = null;
      }
    };
  }, [apiKey, model]);

  const addMemory = async () => {
    if (!newMemKey.trim()) return;
    await window.electron.memory.setUserMemory(newMemKey.trim(), newMemVal.trim());
    setUserMemory(await window.electron.memory.getUserMemory());
    setNewMemKey("");
    setNewMemVal("");
  };

  const runResetHistory = async () => {
    if (!resetConfirm) return;
    setResetting(true);
    try {
      await window.electron.memory.resetHistory();
      setResetConfirm(false);
      onImportComplete?.();
    } finally {
      setResetting(false);
    }
  };

  const runImport = async () => {
    setImporting(true);
    setImportStatus(null);
    try {
      const result = await window.electron.memory.importFromChatGPTFolder();
      setImportStatus(result);
      if (result.imported > 0) onImportComplete?.();
    } catch (e) {
      setImportStatus({
        imported: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="settings-page">
      <header className={`settings-header ${headerScrolled ? "settings-header--scrolled" : ""}`}>
        <button type="button" className="settings-back-btn btn" onClick={onBack}>
          <ArrowLeft size={18} />
          <span className="settings-back-label">Back</span>
        </button>
        <h2 className="settings-title">Settings</h2>
      </header>
      <div ref={scrollRef} className="settings-scroll" onScroll={onScroll}>
        <div className="settings-content">
      <div className="settings-section">
        <label>OpenAI API key</label>
        <input
          type="text"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
        />
      </div>
      <div className="settings-section">
        <label>Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {!OPENAI_MODELS.some((m) => m.value === model) && (
            <option value={model}>{model}</option>
          )}
          {OPENAI_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {saveStatus !== "idle" && (
        <div className="settings-toast" role="status">
          {saveStatus === "saving" ? "Saving…" : "Saved"}
        </div>
      )}

      <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "14px", marginTop: "24px", marginBottom: "8px" }}>User memory</h3>
      <p style={{ color: "var(--fg-muted)", fontSize: "12px", marginBottom: "8px" }}>Facts remembered across conversations.</p>
      {Object.entries(userMemory).map(([k, v]) => (
        <div key={k} style={{ marginBottom: "8px", fontSize: "13px" }}>
          <strong>{k}:</strong> {v}
        </div>
      ))}
      <div className="settings-section" style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Key"
          value={newMemKey}
          onChange={(e) => setNewMemKey(e.target.value)}
          style={{ width: "120px" }}
        />
        <input
          type="text"
          placeholder="Value"
          value={newMemVal}
          onChange={(e) => setNewMemVal(e.target.value)}
          style={{ flex: 1, minWidth: "100px" }}
        />
        <button type="button" className="btn" onClick={addMemory}>Add</button>
      </div>

      <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "14px", marginTop: "24px", marginBottom: "8px" }}>Import ChatGPT history</h3>
      <p style={{ color: "var(--fg-muted)", fontSize: "12px", marginBottom: "8px" }}>
        Import from the raw unzipped ChatGPT export folder (the folder that contains <code>conversations-*.json</code> and optionally <code>shared_conversations.json</code>). Titles and order use shared_conversations when present.
      </p>
      <div className="settings-section" style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          onClick={runImport}
          disabled={importing}
        >
          {importing ? "Importing…" : "Import"}
        </button>
      </div>
      {importStatus != null && (
        <div style={{ marginTop: "8px", fontSize: "13px" }} role="status">
          {importStatus.imported > 0 && (
            <p style={{ color: "var(--fg)" }}>Imported {importStatus.imported} conversation{importStatus.imported !== 1 ? "s" : ""}.</p>
          )}
          {importStatus.errors.length > 0 && (
            <div style={{ color: "var(--fg-muted)" }}>
              <p style={{ marginBottom: "4px" }}>Errors:</p>
              <ul style={{ margin: 0, paddingLeft: "20px" }}>
                {importStatus.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "14px", marginTop: "24px", marginBottom: "8px" }}>Recordings</h3>
      <p style={{ color: "var(--fg-muted)", fontSize: "12px", marginBottom: "8px" }}>
        Voice recordings are saved automatically to the app data folder.
      </p>
      <div className="settings-section" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          type="button"
          className="btn"
          onClick={() => window.electron.recording.openFolder()}
        >
          Open recordings folder
        </button>
      </div>

      <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "14px", marginTop: "24px", marginBottom: "8px" }}>Reset history</h3>
      <p style={{ color: "var(--fg-muted)", fontSize: "12px", marginBottom: "8px" }}>
        Clear all conversations and their messages. Use this to undo an import or start fresh. This cannot be undone.
      </p>
      <div className="settings-section" style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        {!resetConfirm ? (
          <button
            type="button"
            className="btn"
            onClick={() => setResetConfirm(true)}
            disabled={resetting}
          >
            Reset history
          </button>
        ) : (
          <>
            <span style={{ fontSize: "13px", color: "var(--fg-muted)" }}>Clear everything?</span>
            <button
              type="button"
              className="btn"
              onClick={runResetHistory}
              disabled={resetting}
            >
              {resetting ? "Resetting…" : "Yes, clear all"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setResetConfirm(false)}
              disabled={resetting}
            >
              Cancel
            </button>
          </>
        )}
      </div>
        </div>
      </div>
    </div>
  );
}
