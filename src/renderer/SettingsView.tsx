import { useState, useEffect, useRef } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { DEFAULT_SETTINGS } from "../shared/types";
import type { Settings } from "../shared/types";
import { useScrolledHeader } from "./useScrolledHeader";

interface SettingsViewProps {
  onBack: () => void;
  /** After ChatGPT import (new conversations in sidebar). */
  onImportComplete?: () => void;
  /** After full local data erase (conversations, memory file, tasks, plans). */
  onStoredDataReset?: () => void;
}

const SAVE_DEBOUNCE_MS = 500;

const OPENAI_MODELS = [
  { value: "gpt-5.3-codex", label: "Coding" },
  { value: "gpt-5.2", label: "General" },
  { value: "gpt-5-mini", label: "Fast & cheap" },
];

const D = DEFAULT_SETTINGS;

export function SettingsView({ onBack, onImportComplete, onStoredDataReset }: SettingsViewProps) {
  const [activeProvider, setActiveProvider] = useState<"openai" | "ollama">(D.activeProvider);
  const [apiKey, setApiKey] = useState(D.openai!.apiKey);
  const [model, setModel] = useState(D.openai!.model);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(D.ollama!.baseUrl);
  const [ollamaModel, setOllamaModel] = useState(D.ollama!.model);

  const [transcriptionProvider, setTranscriptionProvider] = useState<"openai" | "local">(D.transcription!.activeProvider);
  const [parakeetUseGpu, setParakeetUseGpu] = useState(D.transcription?.parakeet?.useGpu ?? false);
  const [parakeetFp16, setParakeetFp16] = useState(D.transcription?.parakeet?.fp16 ?? false);

  const [autoSend, setAutoSend] = useState(true);
  const [scrollOnStream, setScrollOnStream] = useState(D.chat!.scrollOnStream);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [userMemory, setUserMemory] = useState<Record<string, string>>({});
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemDetail, setNewMemDetail] = useState("");
  const [importStatus, setImportStatus] = useState<{ imported: number; errors: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [isMac] = useState(
    () => typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
  );
  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null);
  const skipNextSaveRef = useRef(true);
  const hideToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();

  useEffect(() => {
    window.electron.settings.get().then((s) => {
      const S = s as Settings;
      setActiveProvider(S.activeProvider ?? D.activeProvider);
      setApiKey(S.openai?.apiKey ?? D.openai!.apiKey);
      setModel(S.openai?.model ?? D.openai!.model);
      setOllamaBaseUrl(S.ollama?.baseUrl ?? D.ollama!.baseUrl);
      setOllamaModel(S.ollama?.model ?? D.ollama!.model);
      setAutoSend(S.recording?.autoSend ?? D.recording!.autoSend);
      setScrollOnStream(S.chat?.scrollOnStream ?? D.chat!.scrollOnStream);
      setTranscriptionProvider(S.transcription?.activeProvider ?? D.transcription!.activeProvider);
      setParakeetUseGpu(S.transcription?.parakeet?.useGpu ?? D.transcription?.parakeet?.useGpu ?? false);
      setParakeetFp16(S.transcription?.parakeet?.fp16 ?? D.transcription?.parakeet?.fp16 ?? false);
    });
    window.electron.memory.getUserMemory().then(setUserMemory);
  }, []);

  useEffect(() => {
    if (!isMac) return;
    void window.electron.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
  }, [isMac]);

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      await window.electron.settings.set({
        activeProvider,
        openai: { apiKey, model },
        ollama: { baseUrl: ollamaBaseUrl, model: ollamaModel },
        recording: { autoSend },
        chat: { scrollOnStream },
        transcription: {
          activeProvider: transcriptionProvider,
          parakeet: { useGpu: parakeetUseGpu, fp16: parakeetFp16 },
        },
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
  }, [activeProvider, apiKey, model, ollamaBaseUrl, ollamaModel, autoSend, scrollOnStream, transcriptionProvider, parakeetUseGpu, parakeetFp16]);

  const addMemory = async () => {
    if (!newMemTitle.trim()) return;
    await window.electron.memory.setUserMemory(newMemTitle.trim(), newMemDetail.trim());
    setUserMemory(await window.electron.memory.getUserMemory());
    setNewMemTitle("");
    setNewMemDetail("");
  };

  const deleteMemoryEntry = async (key: string) => {
    await window.electron.memory.deleteUserMemoryKey(key);
    setUserMemory(await window.electron.memory.getUserMemory());
  };

  const runResetStoredData = async () => {
    if (!resetConfirm) return;
    setResetting(true);
    try {
      await window.electron.memory.resetStoredData();
      setResetConfirm(false);
      onStoredDataReset?.();
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
        <button type="button" className="settings-back-btn btn" data-testid="settings-back" onClick={onBack}>
          <ArrowLeft size={18} />
          <span className="settings-back-label">Back</span>
        </button>
        <h2 className="settings-title">Settings</h2>
      </header>
      <div ref={scrollRef} className="settings-scroll" onScroll={onScroll}>
        <div className="settings-content">

          <section className="settings-group">
            <h3 className="settings-group__title">Chat model</h3>
            <div className="settings-section">
              <label>LLM provider</label>
              <select
                value={activeProvider}
                onChange={(e) => setActiveProvider(e.target.value as "openai" | "ollama")}
              >
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama (local)</option>
              </select>
            </div>

            {activeProvider === "openai" && (
              <>
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
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    {!OPENAI_MODELS.some((m) => m.value === model) && (
                      <option value={model}>{model}</option>
                    )}
                    {OPENAI_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label} — {m.value}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {activeProvider === "ollama" && (
              <>
                <div className="settings-section">
                  <label>Ollama base URL</label>
                  <input
                    type="text"
                    value={ollamaBaseUrl}
                    onChange={(e) => setOllamaBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                  />
                </div>
                <div className="settings-section">
                  <label>Model</label>
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={(e) => setOllamaModel(e.target.value)}
                    placeholder="llama3"
                  />
                </div>
                <p className="settings-group__hint settings-group__hint--flush">
                  Ollama must be running locally. Any model that supports tool calling (e.g. llama3, mistral-nemo) will work.
                </p>
              </>
            )}
          </section>

          <section className="settings-group">
            <h3 className="settings-group__title">Transcription</h3>
            <p className="settings-group__lead">Where voice is turned into text before it reaches the chat.</p>
            <div className="settings-section">
              <label>Provider</label>
              <select
                value={transcriptionProvider}
                onChange={(e) => setTranscriptionProvider(e.target.value as "openai" | "local")}
              >
                <option value="openai">OpenAI Whisper</option>
                <option value="local">Local (Parakeet)</option>
              </select>
            </div>
            {transcriptionProvider === "local" && (
              <>
                <div className="settings-toggle-row">
                  <input
                    id="parakeetGpuToggle"
                    type="checkbox"
                    checked={parakeetUseGpu}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setParakeetUseGpu(v);
                      if (!v) setParakeetFp16(false);
                    }}
                  />
                  <label htmlFor="parakeetGpuToggle">Use GPU (Metal on Apple Silicon)</label>
                </div>
                <div className="settings-toggle-row">
                  <input
                    id="parakeetFp16Toggle"
                    type="checkbox"
                    checked={parakeetFp16}
                    onChange={(e) => setParakeetFp16(e.target.checked)}
                    disabled={!parakeetUseGpu}
                  />
                  <label htmlFor="parakeetFp16Toggle">FP16 (half precision; requires GPU)</label>
                </div>
                <p className="settings-group__hint settings-group__hint--flush">
                  Uses NVIDIA Parakeet TDT 0.6B via{" "}
                  <a href="https://github.com/Frikallo/parakeet.cpp" target="_blank" rel="noreferrer">
                    parakeet.cpp
                  </a>
                  . Bundled by <code>prebuild</code> when you run <code>npm run build</code>; or run <code>npm run parakeet:setup</code> alone (see BUILD.md).
                </p>
              </>
            )}
          </section>

          {isMac && (
            <section className="settings-group">
              <h3 className="settings-group__title">Global voice shortcut (Fn)</h3>
              <p className="settings-group__lead">
                Tap <strong>Fn</strong> once to start recording, then tap <strong>Fn</strong> again to stop and
                transcribe. This requires{" "}
                <strong>Accessibility</strong> for Harness (and the small <code>HarnessFnMonitor</code> helper
                if macOS lists it separately).
              </p>
              <p className="settings-group__hint settings-group__hint--flush">
                After enabling, <strong>quit and reopen Harness</strong> so the Fn listener can attach. If
                nothing happens when you press Fn, use the buttons below — macOS does not always show a prompt
                automatically.
              </p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn"
                  data-testid="settings-accessibility-prompt"
                  onClick={() => {
                    void window.electron.system.requestAccessibilityPrompt();
                    setTimeout(() => {
                      void window.electron.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
                    }, 800);
                  }}
                >
                  Show permission prompt
                </button>
                <button
                  type="button"
                  className="btn"
                  data-testid="settings-open-accessibility"
                  onClick={() => {
                    void window.electron.system.openAccessibilitySettings();
                    setTimeout(() => {
                      void window.electron.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
                    }, 1500);
                  }}
                >
                  Open Accessibility settings
                </button>
              </div>
              {accessibilityTrusted === true ? (
                <p className="settings-group__hint settings-group__hint--flush">
                  Harness reports Accessibility as trusted. If Fn still does nothing, confirm{" "}
                  <code>HarnessFnMonitor</code> is also allowed, then restart the app.
                </p>
              ) : (
                <p className="settings-group__hint settings-group__hint--flush">
                  Status: {accessibilityTrusted === false ? "not trusted yet (or helper still blocked)" : "checking…"}
                </p>
              )}
            </section>
          )}

          <section className="settings-group">
            <h3 className="settings-group__title">Recordings folder</h3>
            <p className="settings-group__lead">
              Voice recordings are saved automatically to the app data folder.
            </p>
            <div className="settings-actions">
              <button
                type="button"
                className="btn"
                onClick={() => window.electron.recording.openFolder()}
              >
                Open recordings folder
              </button>
            </div>
          </section>

          <section className="settings-group">
            <h3 className="settings-group__title">Chat</h3>
            <p className="settings-group__lead">
              While the assistant is generating a reply, keep the transcript scrolled to the bottom so new text stays in view. Turn off if you prefer to read earlier messages without the view moving.
            </p>
            <div className="settings-toggle-row">
              <input
                id="scrollOnStreamToggle"
                data-testid="settings-scroll-on-stream"
                type="checkbox"
                checked={scrollOnStream}
                onChange={(e) => setScrollOnStream(e.target.checked)}
              />
              <label htmlFor="scrollOnStreamToggle">Scroll as the reply streams in</label>
            </div>
          </section>

          <section className="settings-group">
            <h3 className="settings-group__title">Auto-send</h3>
            <p className="settings-group__lead">
              After a voice recording finishes in a new conversation, automatically send the transcription as a new message.
            </p>
            <div className="settings-toggle-row">
              <input
                id="autoSendToggle"
                data-testid="settings-auto-send"
                type="checkbox"
                checked={autoSend}
                onChange={(e) => setAutoSend(e.target.checked)}
              />
              <label htmlFor="autoSendToggle">
                Activate auto-send
              </label>
            </div>
          </section>

          {saveStatus !== "idle" && (
            <div className="settings-toast" role="status">
              {saveStatus === "saving" ? "Saving…" : "Saved"}
            </div>
          )}

          <section className="settings-group">
            <h3 className="settings-group__title">Long-term memory</h3>
            <p className="settings-group__lead">
              Short facts the assistant can rely on in every chat. On each message you send, these entries are merged into the <strong>system prompt</strong> for that request (alongside the fixed assistant instructions), so whichever model you use—OpenAI or local—sees them as context for that turn.
              Use a <strong>short label</strong> (like a filename: <code>preferred_stack</code>) and a <strong>detail</strong> line or two.
              The label must be unique; adding again with the same label replaces the detail.
            </p>
            {Object.entries(userMemory).map(([k, v]) => (
              <div key={k} className="settings-memory-row">
                <div className="settings-memory-entry">
                  <div className="settings-memory-entry__title">{k}</div>
                  <div className="settings-memory-entry__detail">{v || "—"}</div>
                </div>
                <button
                  type="button"
                  className="settings-memory-delete btn btn-icon"
                  onClick={() => deleteMemoryEntry(k)}
                  aria-label={`Remove ${k}`}
                  title="Remove"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <div className="settings-section settings-section--inline settings-memory-add">
              <label className="settings-memory-field">
                <span className="settings-memory-field__label">Label</span>
                <input
                  type="text"
                  placeholder="e.g. timezone"
                  value={newMemTitle}
                  onChange={(e) => setNewMemTitle(e.target.value)}
                  className="settings-input--key"
                  autoComplete="off"
                />
              </label>
              <label className="settings-memory-field settings-memory-field--grow">
                <span className="settings-memory-field__label">Detail</span>
                <input
                  type="text"
                  placeholder="What to remember"
                  value={newMemDetail}
                  onChange={(e) => setNewMemDetail(e.target.value)}
                  className="settings-input--value"
                  autoComplete="off"
                />
              </label>
              <button type="button" className="btn" onClick={addMemory}>
                Save
              </button>
            </div>
          </section>

          <section className="settings-group">
            <h3 className="settings-group__title">Import ChatGPT history</h3>
            <p className="settings-group__lead">
              Import from the raw unzipped ChatGPT export folder (the folder that contains <code>conversations-*.json</code> and optionally <code>shared_conversations.json</code>). Titles and order use shared_conversations when present.
            </p>
            <div className="settings-actions">
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
              <div className="settings-import-status" role="status">
                {importStatus.imported > 0 && (
                  <p className="settings-import-status__ok">
                    Imported {importStatus.imported} conversation{importStatus.imported !== 1 ? "s" : ""}.
                  </p>
                )}
                {importStatus.errors.length > 0 && (
                  <div className="settings-import-status__errors">
                    <p>Errors:</p>
                    <ul>
                      {importStatus.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="settings-group">
            <h3 className="settings-group__title">Reset stored chat data</h3>
            <p className="settings-group__lead">
              Harness keeps data in plain JSON files under your app data folder (there is no separate database). This removes the chat-related files in the <code>memory</code> subdirectory.
            </p>
            <p className="settings-group__hint">
              <strong>Deletes:</strong> <code>conversations.json</code>, every <code>messages_*.json</code> transcript file,{" "}
              <code>user_memory.json</code> (long-term facts above), <code>tasks.json</code>, and <code>plans.json</code>.
            </p>
            <p className="settings-group__hint">
              <strong>Does not delete:</strong> <code>settings.json</code> (API keys and preferences), theme/layout files, or voice recordings in <code>recordings/</code>.
            </p>
            <div className="settings-actions" style={{ marginTop: 12 }}>
              {!resetConfirm ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setResetConfirm(true)}
                  disabled={resetting}
                >
                  Erase all local data
                </button>
              ) : (
                <>
                  <div className="settings-reset-prompt">Erase all of the files listed above?</div>
                  <button
                    type="button"
                    className="btn"
                    onClick={runResetStoredData}
                    disabled={resetting}
                  >
                    {resetting ? "Erasing…" : "Yes, erase"}
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
          </section>
        </div>
      </div>
    </div>
  );
}
