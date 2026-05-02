import {
  useState,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  ExternalLink,
  Eye,
  EyeOff,
  Pencil,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { DEFAULT_SETTINGS } from "../shared/types";
import type { Settings } from "../shared/types";
import type { UsageStatsSnapshot } from "../shared/usageStats";
import { EMPTY_USAGE_STATS } from "../shared/usageStats";
import type { SyncStatus } from "../shared/sync";
import {
  DEFAULT_NOTE_TEMPLATES,
  normalizeNoteTemplates,
  type NoteTemplateConfig,
} from "../shared/writing";
import { useScrolledHeader } from "./useScrolledHeader";
import { Modal } from "./Modal";
import { WorkspaceHeader } from "./WorkspaceHeader";
import {
  DEFAULT_ACCENT_SWATCHES,
  DEFAULT_BG_SWATCHES,
  DEFAULT_FG_SWATCHES,
  DEFAULT_THEME_SETTINGS,
  enforceVeryLowContrastGuard,
  FONT_SIZE_OPTIONS,
  MONO_FONTS,
  normalizeColorPickerValue,
  themeSettingsToCss,
  UI_FONTS,
  type MonoFontId,
  type ThemeSettings,
  type UiFontId,
} from "../shared/theme";

interface SettingsViewProps {
  /** After ChatGPT import (new conversations in sidebar). */
  onImportComplete?: () => void;
  /** After full local data erase (conversations, memory file, tasks, plans). */
  onStoredDataReset?: () => void;
}

const SAVE_DEBOUNCE_MS = 500;

const D = DEFAULT_SETTINGS;
type SettingsTabId = "general" | "tools" | "voice" | "notes" | "memory" | "data";

const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: "general", label: "General" },
  { id: "tools", label: "Tools" },
  { id: "voice", label: "Voice" },
  { id: "notes", label: "Notes" },
  { id: "memory", label: "Memory" },
  { id: "data", label: "Data" },
];

export function SettingsView({ onImportComplete, onStoredDataReset }: SettingsViewProps) {
  const [apiKey, setApiKey] = useState(D.openai!.apiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [usageStats, setUsageStats] = useState<UsageStatsSnapshot>(EMPTY_USAGE_STATS);
  const [switchAnimationsReady, setSwitchAnimationsReady] = useState(false);

  const [cleanupEnabled, setCleanupEnabled] = useState(D.transcription?.cleanup?.enabled ?? false);
  const [cleanupPrompt, setCleanupPrompt] = useState(D.transcription?.cleanup?.prompt ?? "");
  const [cleanupPromptDraft, setCleanupPromptDraft] = useState(D.transcription?.cleanup?.prompt ?? "");
  const [cleanupPromptModalOpen, setCleanupPromptModalOpen] = useState(false);
  const [noteTemplates, setNoteTemplates] = useState<NoteTemplateConfig[]>(
    DEFAULT_NOTE_TEMPLATES.map((t) => ({ ...t })),
  );
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateTitleDraft, setTemplateTitleDraft] = useState("");
  const [templateDescriptionDraft, setTemplateDescriptionDraft] = useState("");
  const [templateContentDraft, setTemplateContentDraft] = useState("");

  const [autoSend, setAutoSend] = useState(true);
  const [weatherZip, setWeatherZip] = useState(D.weather!.defaultZip);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [userMemory, setUserMemory] = useState<Record<string, string>>({});
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [editingMemoryKey, setEditingMemoryKey] = useState<string | null>(null);
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemDetail, setNewMemDetail] = useState("");
  const [importStatus, setImportStatus] = useState<{ imported: number; errors: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [cleanupLegacyBusy, setCleanupLegacyBusy] = useState(false);
  const [cleanupLegacyMessage, setCleanupLegacyMessage] = useState<string | null>(null);
  const [dataStatusLoading, setDataStatusLoading] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<{
    localDataDir: string;
    appStateDir: string;
    localDataExists: boolean;
    conversationsCount: number;
    messageFilesCount: number;
    notesFilesCount: number;
    hasSettingsFile: boolean;
    hasThemesDir: boolean;
    recordingsDir: string;
    recordingsLocalOnly: true;
    legacyMemoryDir: string;
    legacyMemoryExists: boolean;
    sync: SyncStatus;
  } | null>(null);
  const [isMac] = useState(
    () => typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
  );
  const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null);
  const [themeForm, setThemeForm] = useState<ThemeSettings>({ ...DEFAULT_THEME_SETTINGS });
  const [themeApplyBusy, setThemeApplyBusy] = useState(false);
  const [themeApplyError, setThemeApplyError] = useState<string | null>(null);
  const themeApplySeqRef = useRef(0);
  const skipNextSaveRef = useRef(true);
  const hideToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();
  const tabButtonRefs = useRef<Record<SettingsTabId, HTMLButtonElement | null>>({
    general: null,
    tools: null,
    voice: null,
    notes: null,
    memory: null,
    data: null,
  });
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");

  useEffect(() => {
    let cancelled = false;
    const enableSwitchAnimations = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setSwitchAnimationsReady(true);
        });
      });
    };
    void window.electron.settings
      .get()
      .then((s) => {
        if (cancelled) return;
        const S = s as Settings;
        setApiKey(S.openai?.apiKey ?? D.openai!.apiKey);
        setAutoSend(S.recording?.autoSend ?? D.recording!.autoSend);
        setCleanupEnabled(S.transcription?.cleanup?.enabled ?? D.transcription?.cleanup?.enabled ?? false);
        setCleanupPrompt(S.transcription?.cleanup?.prompt ?? D.transcription?.cleanup?.prompt ?? "");
        setCleanupPromptDraft(S.transcription?.cleanup?.prompt ?? D.transcription?.cleanup?.prompt ?? "");
        setWeatherZip(S.weather?.defaultZip ?? D.weather!.defaultZip);
        setNoteTemplates(normalizeNoteTemplates(S.notes?.templates));
      })
      .finally(enableSwitchAnimations);
    void window.electron.usage.getStats().then(setUsageStats);
    window.electron.memory.getUserMemory().then(setUserMemory);
    window.electron.customization.getThemeSettings().then(setThemeForm);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isMac) return;
    void window.electron.system.macosAccessibilityTrusted().then(setAccessibilityTrusted);
  }, [isMac]);

  useEffect(() => {
    if (activeTab !== "data") return;
    void refreshDataStatus();
  }, [activeTab]);

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
            prompt: cleanupPrompt,
          },
        },
        weather: {
          defaultZip: weatherZip.trim(),
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
  }, [apiKey, autoSend, cleanupEnabled, cleanupPrompt, weatherZip]);

  const openCleanupPromptModal = () => {
    setCleanupPromptDraft(cleanupPrompt);
    setCleanupPromptModalOpen(true);
  };

  const closeCleanupPromptModal = () => {
    setCleanupPromptDraft(cleanupPrompt);
    setCleanupPromptModalOpen(false);
  };

  const saveCleanupPrompt = () => {
    const trimmed = cleanupPromptDraft.trim();
    if (!trimmed) return;
    setCleanupPrompt(trimmed);
    setCleanupPromptModalOpen(false);
  };

  const resetCleanupPromptDraft = () => {
    setCleanupPromptDraft(D.transcription?.cleanup?.prompt ?? "");
  };

  const closeTemplatesModal = () => {
    setTemplatesModalOpen(false);
    setEditingTemplateId(null);
    setTemplateTitleDraft("");
    setTemplateDescriptionDraft("");
    setTemplateContentDraft("");
  };

  const openTemplateModal = (template: NoteTemplateConfig) => {
    setEditingTemplateId(template.id);
    setTemplateTitleDraft(template.title);
    setTemplateDescriptionDraft(template.description);
    setTemplateContentDraft(template.content);
    setTemplatesModalOpen(true);
  };

  const saveTemplate = async () => {
    if (!editingTemplateId) return;
    const nextTitle = templateTitleDraft.trim();
    const nextDescription = templateDescriptionDraft.trim();
    if (!nextTitle || !nextDescription) return;
    const nextTemplates = noteTemplates.map((template) =>
      template.id === editingTemplateId
        ? {
            ...template,
            title: nextTitle,
            description: nextDescription,
            content: templateContentDraft,
          }
        : template,
    );
    const normalized = normalizeNoteTemplates(nextTemplates);
    setNoteTemplates(normalized);
    await window.electron.settings.set({ notes: { templates: normalized } });
    window.dispatchEvent(new CustomEvent("notes:templatesUpdated", { detail: normalized }));
    closeTemplatesModal();
  };

  const closeMemoryModal = () => {
    setMemoryModalOpen(false);
    setEditingMemoryKey(null);
    setNewMemTitle("");
    setNewMemDetail("");
  };

  const openAddMemoryModal = () => {
    setEditingMemoryKey(null);
    setNewMemTitle("");
    setNewMemDetail("");
    setMemoryModalOpen(true);
  };

  const openEditMemoryModal = (key: string, detail: string) => {
    setEditingMemoryKey(key);
    setNewMemTitle(key);
    setNewMemDetail(detail);
    setMemoryModalOpen(true);
  };

  const saveMemory = async () => {
    if (!newMemTitle.trim()) return;
    const nextTitle = newMemTitle.trim();
    const nextDetail = newMemDetail.trim();
    if (editingMemoryKey && editingMemoryKey !== nextTitle) {
      await window.electron.memory.deleteUserMemoryKey(editingMemoryKey);
    }
    await window.electron.memory.setUserMemory(nextTitle, nextDetail);
    setUserMemory(await window.electron.memory.getUserMemory());
    closeMemoryModal();
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

  const refreshDataStatus = async () => {
    setDataStatusLoading(true);
    try {
      const status = await window.electron.memory.getDataStatus();
      setDataStatus(status);
    } finally {
      setDataStatusLoading(false);
    }
  };

  const runCleanupLegacyMemory = async () => {
    setCleanupLegacyBusy(true);
    setCleanupLegacyMessage(null);
    try {
      const result = await window.electron.memory.cleanupLegacyMemory();
      setCleanupLegacyMessage(result.removed ? "Removed legacy memory folder." : "No legacy memory folder found.");
      await refreshDataStatus();
    } finally {
      setCleanupLegacyBusy(false);
    }
  };

  const runSyncNow = async () => {
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const result = await window.electron.sync.runNow();
      setSyncMessage(result.ok ? "Sync completed." : result.status.lastError ?? "Sync failed.");
      await refreshDataStatus();
    } finally {
      setSyncBusy(false);
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

  const applyThemeCssImmediately = (settings: ThemeSettings | null) => {
    const el = document.getElementById("custom-theme") as HTMLStyleElement | null;
    if (!el) return;
    if (settings === null) {
      el.textContent = "";
      return;
    }
    el.textContent = themeSettingsToCss(settings);
  };

  const updateThemeForm = (updater: (prev: ThemeSettings) => ThemeSettings) => {
    setThemeForm((prev) => {
      const updated = updater(prev);
      const changedFg = updated.fg !== prev.fg;
      const changedBg = updated.bg !== prev.bg;
      const next =
        changedFg !== changedBg
          ? {
              ...updated,
              ...enforceVeryLowContrastGuard(
                { fg: updated.fg, bg: updated.bg },
                changedFg ? "fg" : "bg",
              ),
            }
          : updated;
      applyThemeCssImmediately(next);
      const seq = ++themeApplySeqRef.current;
      setThemeApplyBusy(true);
      setThemeApplyError(null);
      void window.electron.customization
        .setThemeSettings(next)
        .catch((e) => {
          if (seq !== themeApplySeqRef.current) return;
          setThemeApplyError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (seq === themeApplySeqRef.current) setThemeApplyBusy(false);
        });
      return next;
    });
  };

  const resetThemeToBuiltin = async () => {
    setThemeApplyBusy(true);
    setThemeApplyError(null);
    try {
      applyThemeCssImmediately(null);
      await window.electron.customization.setThemeSettings(null);
      setThemeForm({ ...DEFAULT_THEME_SETTINGS });
    } catch (e) {
      setThemeApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setThemeApplyBusy(false);
    }
  };

  const switchTab = (id: SettingsTabId) => {
    setActiveTab(id);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "auto" });
    }
  };

  const focusTab = (id: SettingsTabId) => {
    tabButtonRefs.current[id]?.focus();
  };

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, id: SettingsTabId) => {
    const idx = SETTINGS_TABS.findIndex((tab) => tab.id === id);
    if (idx < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = SETTINGS_TABS[(idx + 1) % SETTINGS_TABS.length].id;
      focusTab(next);
      switchTab(next);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = SETTINGS_TABS[(idx - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length].id;
      focusTab(prev);
      switchTab(prev);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusTab(SETTINGS_TABS[0].id);
      switchTab(SETTINGS_TABS[0].id);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      const last = SETTINGS_TABS[SETTINGS_TABS.length - 1].id;
      focusTab(last);
      switchTab(last);
    }
  };

  return (
    <div className="workspace-page settings-page">
      <WorkspaceHeader
        title="Settings"
        icon={<SettingsIcon size={18} />}
        scrolled={headerScrolled}
        actions={
          <div
            className={`settings-tabs settings-tabs--header${headerScrolled ? " settings-tabs--latched" : ""}`}
            role="tablist"
            aria-label="Settings sections"
          >
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                ref={(el) => {
                  tabButtonRefs.current[tab.id] = el;
                }}
                id={`settings-tab-${tab.id}`}
                type="button"
                role="tab"
                className={`settings-tab${activeTab === tab.id ? " settings-tab--active" : ""}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`settings-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => switchTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
      />
      <div ref={scrollRef} className="workspace-scroll settings-scroll" onScroll={onScroll}>
        <div className="workspace-content settings-content">
          {activeTab === "general" && <section
            id="settings-panel-general"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-general"
          >
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
            </section>

            <section className="settings-group">
              <h3 className="settings-group__title">App preferences</h3>
              <p className="settings-group__lead">
                Core app configuration that applies globally across chat and voice workflows.
              </p>
            </section>

            <section className="settings-group">
              <h3 className="settings-group__title">Theme studio</h3>
              <p className="settings-group__lead settings-group__lead--tight">
                Background, text, accent; UI and code fonts (Google Fonts load with the app); base size. Changes apply
                instantly and save to your theme (replacing any previous custom theme from this screen or tools).
              </p>
              <div className="settings-playground">
                <div className="settings-playground-tools settings-section">
                  <div className="settings-playground-columns">
                    <div className="settings-playground-column" aria-label="Color controls">
                      <h4 className="settings-playground-column__title">Colors</h4>
                      <div className="settings-playground-field">
                        <label htmlFor="theme-bg">Background color</label>
                        <div className="settings-playground-color-row">
                          <input
                            id="theme-bg"
                            type="color"
                            value={normalizeColorPickerValue(themeForm.bg)}
                            onChange={(e) => updateThemeForm((f) => ({ ...f, bg: e.target.value }))}
                            aria-label="Background color picker"
                          />
                          <input
                            type="text"
                            value={themeForm.bg}
                            onChange={(e) => updateThemeForm((f) => ({ ...f, bg: e.target.value }))}
                            spellCheck={false}
                            autoComplete="off"
                            aria-label="Background hex"
                          />
                        </div>
                        <div className="settings-playground-swatch-grid" role="list" aria-label="Background presets">
                          {DEFAULT_BG_SWATCHES.map((bg) => {
                            const isSelected = normalizeColorPickerValue(themeForm.bg) === bg;
                            return (
                              <button
                                key={bg}
                                type="button"
                                className={`settings-playground-swatch${isSelected ? " settings-playground-swatch--selected" : ""}`}
                                onClick={() => updateThemeForm((f) => ({ ...f, bg }))}
                                aria-label={`Use background ${bg}`}
                                aria-pressed={isSelected}
                                style={{ "--swatch-color": bg } as CSSProperties}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <div className="settings-playground-field">
                        <label htmlFor="theme-fg">Text color</label>
                        <div className="settings-playground-color-row">
                          <input
                            id="theme-fg"
                            type="color"
                            value={normalizeColorPickerValue(themeForm.fg)}
                            onChange={(e) => updateThemeForm((f) => ({ ...f, fg: e.target.value }))}
                            aria-label="Text color picker"
                          />
                          <input
                            type="text"
                            value={themeForm.fg}
                            onChange={(e) => updateThemeForm((f) => ({ ...f, fg: e.target.value }))}
                            spellCheck={false}
                            autoComplete="off"
                            aria-label="Text color hex"
                          />
                        </div>
                        <div className="settings-playground-swatch-grid" role="list" aria-label="Text color presets">
                          {DEFAULT_FG_SWATCHES.map((fg) => {
                            const isSelected = normalizeColorPickerValue(themeForm.fg) === fg;
                            return (
                              <button
                                key={fg}
                                type="button"
                                className={`settings-playground-swatch${isSelected ? " settings-playground-swatch--selected" : ""}`}
                                onClick={() => updateThemeForm((f) => ({ ...f, fg }))}
                                aria-label={`Use text color ${fg}`}
                                aria-pressed={isSelected}
                                style={{ "--swatch-color": fg } as CSSProperties}
                              />
                            );
                          })}
                        </div>
                      </div>
                      <div className="settings-playground-field">
                        <label htmlFor="theme-accent">Accent color</label>
                        <div className="settings-playground-color-row">
                          <input
                            id="theme-accent"
                            type="color"
                            value={normalizeColorPickerValue(themeForm.accent)}
                            onChange={(e) => updateThemeForm((f) => ({ ...f, accent: e.target.value }))}
                            aria-label="Accent color picker"
                          />
                          <input
                            type="text"
                            value={themeForm.accent}
                            onChange={(e) => updateThemeForm((f) => ({ ...f, accent: e.target.value }))}
                            spellCheck={false}
                            autoComplete="off"
                            aria-label="Accent hex"
                          />
                        </div>
                        <div className="settings-playground-accent-grid" role="list" aria-label="Default accents">
                          {DEFAULT_ACCENT_SWATCHES.map((accent) => {
                            const isSelected = normalizeColorPickerValue(themeForm.accent) === accent;
                            return (
                              <button
                                key={accent}
                                type="button"
                                className={`settings-playground-accent-swatch${isSelected ? " settings-playground-accent-swatch--selected" : ""}`}
                                onClick={() => updateThemeForm((f) => ({ ...f, accent }))}
                                aria-label={`Use accent ${accent}`}
                                aria-pressed={isSelected}
                                style={{ "--swatch-color": accent } as CSSProperties}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="settings-playground-column" aria-label="Font controls">
                      <h4 className="settings-playground-column__title">Fonts</h4>
                      <div className="settings-playground-field">
                        <label htmlFor="theme-font">UI font</label>
                        <select
                          id="theme-font"
                          value={themeForm.font}
                          onChange={(e) =>
                            updateThemeForm((f) => ({ ...f, font: e.target.value as UiFontId }))
                          }
                        >
                          {UI_FONTS.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="settings-playground-field">
                        <label htmlFor="theme-font-mono">Code / notes font</label>
                        <select
                          id="theme-font-mono"
                          value={themeForm.fontMono}
                          onChange={(e) =>
                            updateThemeForm((f) => ({ ...f, fontMono: e.target.value as MonoFontId }))
                          }
                        >
                          {MONO_FONTS.map((o) => (
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
                            updateThemeForm((f) => ({
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
                    </div>
                  </div>
                  <div className="settings-actions settings-playground-actions">
                    <button
                      type="button"
                      className="btn"
                      disabled={themeApplyBusy}
                      onClick={() => void resetThemeToBuiltin()}
                    >
                      Reset
                    </button>
                  </div>
                  {themeApplyError && (
                    <p className="settings-playground-status settings-playground-status--err" role="alert">
                      {themeApplyError}
                    </p>
                  )}
                </div>
              </div>
            </section>
          </section>}

          {activeTab === "tools" && <section
            id="settings-panel-tools"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-tools"
          >
            <section className="settings-group">
              <h3 className="settings-group__title">Weather tool</h3>
              <p className="settings-group__lead">
                Default US ZIP used by the <code>get_weather</code> tool when the assistant does not specify a location.
                Powered by Open-Meteo (no API key).
              </p>
              <div className="settings-section">
                <label htmlFor="settings-weather-zip">Default ZIP</label>
                <input
                  id="settings-weather-zip"
                  data-testid="settings-weather-zip"
                  type="text"
                  value={weatherZip}
                  onChange={(e) => setWeatherZip(e.target.value)}
                  placeholder="12528"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  spellCheck={false}
                  maxLength={5}
                />
              </div>
            </section>
          </section>}

          {activeTab === "voice" && <section
            id="settings-panel-voice"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-voice"
          >
            <section className="settings-group">
              <h3 className="settings-group__title">Voice & transcription</h3>
              <p className="settings-group__lead">
                Spoken audio is turned into text on this device. Optional cleanup uses your API key.
              </p>

              <label
                className={`settings-switch-row${switchAnimationsReady ? "" : " settings-switch-row--static"}`}
              >
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
              <div className="settings-actions settings-cleanup-prompt__actions">
                <button type="button" className="btn" onClick={openCleanupPromptModal}>
                  Edit prompt
                </button>
              </div>
              <div className="settings-section settings-section--usage">
                <dl className="usage-stats">
                  <div className="usage-stats__row">
                    <dt>Parakeet words transcribed</dt>
                    <dd>{usageStats.parakeet.words.toLocaleString()}</dd>
                  </div>
                  <div className="usage-stats__row">
                    <dt>Dictation sessions</dt>
                    <dd>{usageStats.parakeet.transcriptions.toLocaleString()}</dd>
                  </div>
                </dl>

                <div className="settings-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => window.electron.recording.openFolder()}
                  >
                    Show Recordings <ExternalLink size={14} aria-hidden />
                  </button>
                </div>
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
                {accessibilityTrusted !== true && (
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
                    Ask for permission <ExternalLink size={14} aria-hidden />
                  </button>
                )}
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
                  Open accessibility <ExternalLink size={14} aria-hidden />
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
            <label
              className={`settings-switch-row${switchAnimationsReady ? "" : " settings-switch-row--static"}`}
            >
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
          </section>}

          {saveStatus !== "idle" && (
            <div className="settings-toast" role="status">
              {saveStatus === "saving" ? "Saving…" : "Saved"}
            </div>
          )}

          {activeTab === "notes" && <section
            id="settings-panel-notes"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-notes"
          >
            <section className="settings-group">
              <h3 className="settings-group__title">Notes templates</h3>
              <p className="settings-group__lead">
                Edit the three note templates shown on the Notes overview page.
              </p>
              <div className="settings-notes-templates-list">
                {noteTemplates.map((template) => (
                  <div key={template.id} className="settings-notes-template-row">
                    <div className="settings-notes-template-entry">
                      <div className="settings-notes-template-entry__title">{template.title}</div>
                      <div className="settings-notes-template-entry__description">{template.description}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-icon"
                      onClick={() => openTemplateModal(template)}
                      aria-label={`Edit ${template.title} template`}
                      title="Edit template"
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </section>}

          {activeTab === "memory" && <section
            id="settings-panel-memory"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-memory"
          >
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
                    className="settings-memory-edit btn btn-icon"
                    onClick={() => openEditMemoryModal(k, v)}
                    aria-label={`Edit ${k}`}
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </button>
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
              <div className="settings-actions">
                <button
                  type="button"
                  className="btn"
                  data-testid="settings-add-memory"
                  onClick={openAddMemoryModal}
                >
                  Add memory
                </button>
              </div>
            </section>
          </section>}

          <Modal
            open={cleanupPromptModalOpen}
            onClose={closeCleanupPromptModal}
            title="Automatic text cleanup prompt"
            data-testid="settings-cleanup-prompt-modal"
            footer={
              <>
                <button type="button" className="btn" onClick={closeCleanupPromptModal}>
                  Cancel
                </button>
                <button type="button" className="btn" onClick={resetCleanupPromptDraft}>
                  Reset to default
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveCleanupPrompt}
                  disabled={!cleanupPromptDraft.trim()}
                >
                  Save
                </button>
              </>
            }
          >
            <div className="settings-memory-modal-stack">
              <label className="settings-memory-field">
                <span className="settings-memory-field__label">Prompt text</span>
                <textarea
                  placeholder="Describe how dictation should be cleaned up."
                  value={cleanupPromptDraft}
                  onChange={(e) => setCleanupPromptDraft(e.target.value)}
                  className="app-modal-input settings-memory-detail-input"
                  rows={6}
                />
              </label>
            </div>
          </Modal>

          <Modal
            open={memoryModalOpen}
            onClose={closeMemoryModal}
            title={editingMemoryKey ? "Edit memory" : "Add memory"}
            data-testid="settings-memory-modal"
            footer={
              <>
                <button type="button" className="btn" onClick={closeMemoryModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveMemory()}
                  disabled={!newMemTitle.trim()}
                >
                  {editingMemoryKey ? "Update" : "Save"}
                </button>
              </>
            }
          >
            <div className="settings-memory-modal-stack">
              <label className="settings-memory-field">
                <span className="settings-memory-field__label">Label</span>
                <input
                  type="text"
                  placeholder="e.g. timezone"
                  value={newMemTitle}
                  onChange={(e) => setNewMemTitle(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
              <label className="settings-memory-field">
                <span className="settings-memory-field__label">Detail</span>
                <textarea
                  placeholder="What to remember"
                  value={newMemDetail}
                  onChange={(e) => setNewMemDetail(e.target.value)}
                  className="app-modal-input settings-memory-detail-input"
                  rows={4}
                  autoComplete="off"
                />
              </label>
            </div>
          </Modal>

          <Modal
            open={templatesModalOpen}
            onClose={closeTemplatesModal}
            title="Edit notes template"
            data-testid="settings-notes-template-modal"
            footer={
              <>
                <button type="button" className="btn" onClick={closeTemplatesModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveTemplate()}
                  disabled={!templateTitleDraft.trim() || !templateDescriptionDraft.trim()}
                >
                  Save
                </button>
              </>
            }
          >
            <div className="settings-memory-modal-stack">
              <label className="settings-memory-field">
                <span className="settings-memory-field__label">Title</span>
                <input
                  type="text"
                  value={templateTitleDraft}
                  onChange={(e) => setTemplateTitleDraft(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
              <label className="settings-memory-field">
                <span className="settings-memory-field__label">Description</span>
                <input
                  type="text"
                  value={templateDescriptionDraft}
                  onChange={(e) => setTemplateDescriptionDraft(e.target.value)}
                  className="app-modal-input"
                  autoComplete="off"
                />
              </label>
              <label className="settings-memory-field">
                <span className="settings-memory-field__label">Template body</span>
                <textarea
                  value={templateContentDraft}
                  onChange={(e) => setTemplateContentDraft(e.target.value)}
                  className="app-modal-input settings-memory-detail-input settings-notes-template-content-input"
                  rows={10}
                />
              </label>
            </div>
          </Modal>

          {activeTab === "data" && <section
            id="settings-panel-data"
            className="settings-tab-panel"
            role="tabpanel"
            aria-labelledby="settings-tab-data"
          >
            <section className="settings-group">
              <h3 className="settings-group__title">Local data</h3>
              <p className="settings-group__lead">
                Local-first storage root and sync status. Recordings remain local-only unless exported manually.
              </p>
              <div className="settings-actions">
                <button type="button" className="btn" onClick={() => window.electron.memory.openLocalDataFolder()}>
                  Show local-data folder <ExternalLink size={14} aria-hidden />
                </button>
                <button type="button" className="btn" onClick={() => void refreshDataStatus()} disabled={dataStatusLoading}>
                  {dataStatusLoading ? "Refreshing…" : "Refresh status"}
                </button>
              </div>
              {dataStatus && (
                <div className="settings-data-status" role="status">
                  <p><strong>Local folder:</strong> {dataStatus.localDataDir}</p>
                  <p><strong>App-state folder:</strong> {dataStatus.appStateDir}</p>
                  <p>
                    <strong>Counts:</strong> {dataStatus.conversationsCount} conversations, {dataStatus.messageFilesCount} message files,{" "}
                    {dataStatus.notesFilesCount} notes
                  </p>
                  <p>
                    <strong>Settings/themes:</strong> {dataStatus.hasSettingsFile ? "settings present" : "settings missing"},{" "}
                    {dataStatus.hasThemesDir ? "themes present" : "themes missing"}
                  </p>
                  <p><strong>Recordings:</strong> Local-only in {dataStatus.recordingsDir}</p>
                  <p>
                    <strong>Firebase sync:</strong>{" "}
                    {dataStatus.sync.configured ? "configured" : "not configured"}
                    {dataStatus.sync.lastSuccessAt ? `, last success ${new Date(dataStatus.sync.lastSuccessAt).toLocaleString()}` : ""}
                    {dataStatus.sync.lastError ? `, last error: ${dataStatus.sync.lastError}` : ""}
                  </p>
                </div>
              )}
              <div className="settings-actions">
                <button type="button" className="btn" onClick={() => void runSyncNow()} disabled={syncBusy}>
                  {syncBusy ? "Syncing…" : "Sync now"}
                </button>
              </div>
              {syncMessage && <p className="settings-group__hint settings-group__hint--flush">{syncMessage}</p>}
              <div className="settings-actions">
                <button type="button" className="btn" onClick={() => void runCleanupLegacyMemory()} disabled={cleanupLegacyBusy}>
                  {cleanupLegacyBusy ? "Cleaning…" : "Cleanup legacy memory folder"}
                </button>
              </div>
              {cleanupLegacyMessage && (
                <p className="settings-group__hint settings-group__hint--flush">{cleanupLegacyMessage}</p>
              )}
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
          </section>}
        </div>
      </div>
    </div>
  );
}
