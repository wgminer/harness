import { useState, useEffect, useRef, type CSSProperties } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { DEFAULT_SETTINGS } from "../shared/types";
import type { Settings } from "../shared/types";
import type { UsageStatsSnapshot } from "../shared/usageStats";
import { EMPTY_USAGE_STATS } from "../shared/usageStats";
import { useScrolledHeader } from "./useScrolledHeader";
import {
  BODY_FONT_OPTIONS,
  MONO_FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  THEME_FORM_DEFAULT,
  buildThemeCss,
  themeFromStoredCss,
  normalizeColorPickerValue,
  headingToCssValue,
  BODY_FONT_STACKS,
  MONO_FONT_STACKS,
  type BodyFontId,
  type MonoFontId,
  type HeadingFontChoice,
} from "./themeFonts";

interface SettingsViewProps {
  /** After ChatGPT import (new conversations in sidebar). */
  onImportComplete?: () => void;
  /** After full local data erase (conversations, memory file, tasks, plans). */
  onStoredDataReset?: () => void;
}

const SAVE_DEBOUNCE_MS = 500;

const D = DEFAULT_SETTINGS;

export function SettingsView({ onImportComplete, onStoredDataReset }: SettingsViewProps) {
  const [apiKey, setApiKey] = useState(D.openai!.apiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [usageStats, setUsageStats] = useState<UsageStatsSnapshot>(EMPTY_USAGE_STATS);

  const [cleanupEnabled, setCleanupEnabled] = useState(D.transcription?.cleanup?.enabled ?? false);

  const [autoSend, setAutoSend] = useState(true);
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
  const [themeForm, setThemeForm] = useState({ ...THEME_FORM_DEFAULT });
  const [themeApplyBusy, setThemeApplyBusy] = useState(false);
  const [themeApplyMessage, setThemeApplyMessage] = useState<string | null>(null);
  const [themeApplyError, setThemeApplyError] = useState<string | null>(null);
  const themeMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(true);
  const hideToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();

  useEffect(() => {
    window.electron.settings.get().then((s) => {
      const S = s as Settings;
      setApiKey(S.openai?.apiKey ?? D.openai!.apiKey);
      setAutoSend(S.recording?.autoSend ?? D.recording!.autoSend);
      setCleanupEnabled(S.transcription?.cleanup?.enabled ?? D.transcription?.cleanup?.enabled ?? false);
    });
    void window.electron.usage.getStats().then(setUsageStats);
    window.electron.memory.getUserMemory().then(setUserMemory);
    window.electron.customization.getActiveTheme().then((css) => {
      setThemeForm(themeFromStoredCss(css));
    });
  }, []);

  useEffect(() => {
    if (!isMac) return;
    void window.electron.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
  }, [isMac]);

  useEffect(
    () => () => {
      if (themeMsgTimerRef.current) clearTimeout(themeMsgTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      await window.electron.settings.set({
        openai: { apiKey },
        recording: { autoSend },
        transcription: {
          cleanup: {
            enabled: cleanupEnabled,
          },
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
  }, [apiKey, autoSend, cleanupEnabled]);

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

  const showThemeNotice = (msg: string) => {
    if (themeMsgTimerRef.current) clearTimeout(themeMsgTimerRef.current);
    setThemeApplyError(null);
    setThemeApplyMessage(msg);
    themeMsgTimerRef.current = setTimeout(() => {
      setThemeApplyMessage(null);
      themeMsgTimerRef.current = null;
    }, 2200);
  };

  const applyTheme = async () => {
    setThemeApplyBusy(true);
    setThemeApplyError(null);
    try {
      await window.electron.customization.setTheme(buildThemeCss(themeForm));
      showThemeNotice("Theme applied");
    } catch (e) {
      setThemeApplyMessage(null);
      setThemeApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setThemeApplyBusy(false);
    }
  };

  const resetThemeToBuiltin = async () => {
    setThemeApplyBusy(true);
    setThemeApplyError(null);
    try {
      await window.electron.customization.setTheme("");
      setThemeForm({ ...THEME_FORM_DEFAULT });
      showThemeNotice("Restored built-in theme");
    } catch (e) {
      setThemeApplyMessage(null);
      setThemeApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setThemeApplyBusy(false);
    }
  };

  const playgroundPreviewStyle = {
    "--accent": themeForm.accent,
    "--font-family": BODY_FONT_STACKS[themeForm.bodyFont],
    "--font-mono": MONO_FONT_STACKS[themeForm.monoFont],
    "--font-heading": headingToCssValue(themeForm.headingFont),
    "--font-size": `${themeForm.fontSize}px`,
    "--line-height": 1.5,
  } as CSSProperties;

  return (
    <div className="settings-page">
      <header className={`settings-header ${headerScrolled ? "settings-header--scrolled" : ""}`}>
        <div className="settings-header-inner">
          <h2 className="settings-title">Settings</h2>
        </div>
      </header>
      <div ref={scrollRef} className="settings-scroll" onScroll={onScroll}>
        <div className="settings-content">

          <section className="settings-group">
            <h3 className="settings-group__title">Chat model</h3>
            <p className="settings-group__lead">
              Paste your key from OpenAI. Chat and titles use it; voice is handled on your Mac.
            </p>
            <div className="settings-section">
              <label htmlFor="settings-api-key">API key</label>
              <div className="settings-api-key-row">
                <input
                  id="settings-api-key"
                  type={showApiKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                />
                <button
                  type="button"
                  className="btn btn-icon"
                  aria-pressed={showApiKey}
                  aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  title={showApiKey ? "Hide key" : "Show key"}
                  onClick={() => setShowApiKey((v) => !v)}
                >
                  {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="settings-section settings-section--usage">
              <p className="settings-group__lead settings-group__lead--tight">
                Estimated usage recorded on this Mac (chat, titles, transcript cleanup). Parakeet runs locally; counts
                come from its CLI and transcribed text.
              </p>
              <dl className="usage-stats">
                <div className="usage-stats__row">
                  <dt>OpenAI tokens (prompt)</dt>
                  <dd>{usageStats.openai.promptTokens.toLocaleString()}</dd>
                </div>
                <div className="usage-stats__row">
                  <dt>OpenAI tokens (completion)</dt>
                  <dd>{usageStats.openai.completionTokens.toLocaleString()}</dd>
                </div>
                <div className="usage-stats__row usage-stats__row--emph">
                  <dt>OpenAI tokens (total)</dt>
                  <dd>{usageStats.openai.totalTokens.toLocaleString()}</dd>
                </div>
                <div className="usage-stats__row">
                  <dt>Parakeet model tokens</dt>
                  <dd>{usageStats.parakeet.modelTokens.toLocaleString()}</dd>
                </div>
                <div className="usage-stats__row">
                  <dt>Parakeet words transcribed</dt>
                  <dd>{usageStats.parakeet.words.toLocaleString()}</dd>
                </div>
                <div className="usage-stats__row">
                  <dt>Dictation sessions</dt>
                  <dd>{usageStats.parakeet.transcriptions.toLocaleString()}</dd>
                </div>
              </dl>
              {usageStats.updatedAt > 0 && (
                <p className="settings-group__hint settings-group__hint--flush">
                  Last updated {new Date(usageStats.updatedAt).toLocaleString()}
                </p>
              )}
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void window.electron.usage.openOpenAIDashboard();
                  }}
                >
                  OpenAI usage &amp; billing
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void window.electron.usage.getStats().then(setUsageStats);
                  }}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (!window.confirm("Clear OpenAI and Parakeet usage tallies on this device?")) return;
                    void window.electron.usage.reset().then(setUsageStats);
                  }}
                >
                  Reset local tallies
                </button>
              </div>
            </div>
          </section>

          <section className="settings-group">
            <h3 className="settings-group__title">Voice & transcription</h3>
            <p className="settings-group__lead">
              Spoken audio is turned into text on this device. Optional cleanup uses your API key.
            </p>
            <label className="settings-switch-row">
              <input
                id="transcriptCleanupToggle"
                type="checkbox"
                className="settings-switch-input"
                checked={cleanupEnabled}
                onChange={(e) => setCleanupEnabled(e.target.checked)}
              />
              <span className="settings-switch-track" aria-hidden="true">
                <span className="settings-switch-thumb" />
              </span>
              <span className="settings-switch-text">Automatically tidy up dictation text</span>
            </label>
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

          {isMac && (
            <section className="settings-group">
              <h3 className="settings-group__title">Fn shortcut</h3>
              <p className="settings-group__lead">
                Press <strong>Fn</strong> to start recording, press again to stop. Harness needs Accessibility; allow <code>HarnessFnMonitor</code> too if macOS lists it.
              </p>
              <p className="settings-group__hint settings-group__hint--flush">
                After changing permissions, quit and reopen the app. Use the buttons if macOS doesn’t prompt you.
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
                  Ask for permission
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
                  Open accessibility
                </button>
              </div>
              <p className="settings-group__hint settings-group__hint--flush">
                {accessibilityTrusted === true
                  ? "Accessibility looks good. If Fn still won’t work, restart and check both Harness and Fn Monitor."
                  : accessibilityTrusted === false
                    ? "Accessibility not enabled yet."
                    : "Checking…"}
              </p>
            </section>
          )}

          <section className="settings-group">
            <h3 className="settings-group__title">After dictation</h3>
            <p className="settings-group__lead">Send the transcribed message right away in a new chat.</p>
            <label className="settings-switch-row">
              <input
                id="autoSendToggle"
                data-testid="settings-auto-send"
                type="checkbox"
                className="settings-switch-input"
                checked={autoSend}
                onChange={(e) => setAutoSend(e.target.checked)}
              />
              <span className="settings-switch-track" aria-hidden="true">
                <span className="settings-switch-thumb" />
              </span>
              <span className="settings-switch-text">Auto-send</span>
            </label>
          </section>

          {saveStatus !== "idle" && (
            <div className="settings-toast" role="status">
              {saveStatus === "saving" ? "Saving…" : "Saved"}
            </div>
          )}

          <section className="settings-group">
            <h3 className="settings-group__title">Memory</h3>
            <p className="settings-group__lead">
              Stable facts the assistant can use in every conversation. Pick a short name and a one-line detail; same name updates the old entry.
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
            <h3 className="settings-group__title">Import from ChatGPT</h3>
            <p className="settings-group__lead">Choose the folder from an unzipped ChatGPT export.</p>
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
            <h3 className="settings-group__title">{"Theme preview"}</h3>
            <p className="settings-group__lead">
              Adjust accent, fonts (including Google Fonts loaded with the app), and base size. The preview uses
              your current app colors; only the accent is overridden here until you apply. Apply saves your
              overrides to the theme file (replacing any previous custom theme from this screen or tools).
            </p>
            <div className="settings-playground">
              <div className="settings-playground-tools settings-section">
                <div className="settings-playground-field">
                  <label htmlFor="theme-accent">Accent color</label>
                  <div className="settings-playground-color-row">
                    <input
                      id="theme-accent"
                      type="color"
                      value={normalizeColorPickerValue(themeForm.accent)}
                      onChange={(e) =>
                        setThemeForm((f) => ({ ...f, accent: e.target.value }))
                      }
                      aria-label="Accent color picker"
                    />
                    <input
                      type="text"
                      value={themeForm.accent}
                      onChange={(e) => setThemeForm((f) => ({ ...f, accent: e.target.value }))}
                      spellCheck={false}
                      autoComplete="off"
                      aria-label="Accent hex"
                    />
                  </div>
                </div>
                <div className="settings-playground-field">
                  <label htmlFor="theme-body-font">Body font</label>
                  <select
                    id="theme-body-font"
                    value={themeForm.bodyFont}
                    onChange={(e) =>
                      setThemeForm((f) => ({ ...f, bodyFont: e.target.value as BodyFontId }))
                    }
                  >
                    {BODY_FONT_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-playground-field">
                  <label htmlFor="theme-heading-font">Heading font</label>
                  <select
                    id="theme-heading-font"
                    value={themeForm.headingFont}
                    onChange={(e) =>
                      setThemeForm((f) => ({
                        ...f,
                        headingFont: e.target.value as HeadingFontChoice,
                      }))
                    }
                  >
                    <option value="same_body">Same as body</option>
                    <option value="same_mono">Same as mono</option>
                    {BODY_FONT_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-playground-field">
                  <label htmlFor="theme-mono-font">Mono / button font</label>
                  <select
                    id="theme-mono-font"
                    value={themeForm.monoFont}
                    onChange={(e) =>
                      setThemeForm((f) => ({ ...f, monoFont: e.target.value as MonoFontId }))
                    }
                  >
                    {MONO_FONT_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-playground-field">
                  <label htmlFor="theme-font-size">Base font size</label>
                  <select
                    id="theme-font-size"
                    value={themeForm.fontSize}
                    onChange={(e) =>
                      setThemeForm((f) => ({
                        ...f,
                        fontSize: Number(e.target.value) as (typeof FONT_SIZE_OPTIONS)[number],
                      }))
                    }
                  >
                    {FONT_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}px
                      </option>
                    ))}
                  </select>
                </div>
                <div className="settings-actions settings-playground-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={themeApplyBusy}
                    onClick={() => void applyTheme()}
                  >
                    {themeApplyBusy ? "Applying…" : "Apply theme"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={themeApplyBusy}
                    onClick={() => void resetThemeToBuiltin()}
                  >
                    Reset to built-in
                  </button>
                </div>
                {themeApplyMessage && (
                  <p className="settings-playground-status settings-playground-status--ok" role="status">
                    {themeApplyMessage}
                  </p>
                )}
                {themeApplyError && (
                  <p className="settings-playground-status settings-playground-status--err" role="alert">
                    {themeApplyError}
                  </p>
                )}
              </div>
              <div className="settings-playground-canvas" style={playgroundPreviewStyle}>
                <h4 className="settings-playground-canvas__title">Conversation title</h4>
                <p className="settings-playground-canvas__body">
                  This paragraph uses the body stack and size.{" "}
                  <span className="settings-playground-canvas__accent">Accent</span> highlights links and focus.
                </p>
                <p className="settings-playground-canvas__muted">
                  Secondary line — timestamps, hints, and labels often look like this.
                </p>
                <div className="settings-playground-canvas__panel">
                  <span className="settings-playground-canvas__panel-label">Inset</span>
                  <p className="settings-playground-canvas__body settings-playground-canvas__body--tight">
                    A block on a lifted surface uses the secondary background.
                  </p>
                </div>
                <button type="button" className="settings-playground-canvas__btn">
                  Sample button
                </button>
              </div>
            </div>
          </section>

          <section className="settings-group">
            <h3 className="settings-group__title">Erase local data</h3>
            <p className="settings-group__lead">
              Removes chats, tasks, plans, and memory entries. Keeps settings, theme, and your recording files.
            </p>
            <div className="settings-actions">
              {!resetConfirm ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setResetConfirm(true)}
                  disabled={resetting}
                >
                  Erase…
                </button>
              ) : (
                <>
                  <div className="settings-reset-prompt">Erase everything listed above?</div>
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
