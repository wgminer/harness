import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Eye, EyeOff, Settings as SettingsIcon } from "lucide-react";
import { snapToGrid } from "../shared/grid";
import type { ConfigEntry, ConfigViewSpec } from "../shared/configRegistry";
import type { TranscriptDictionaryEntry } from "../shared/types";
import {
  normalizeNoteTemplateDescription,
  normalizeNoteTemplates,
  type NoteTemplateConfig,
} from "../shared/writing";
import {
  normalizeColorPickerValue,
  parseHexColor,
  themeSettingsToCss,
  type ThemeSettings,
} from "../shared/theme";
import { useScrolledHeader } from "./useScrolledHeader";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { Modal } from "./Modal";
import {
  SettingsEntryRow,
  SettingsField,
  SettingsGroup,
  SettingsHint,
  SettingsSwitch,
  SettingsSwitchProvider,
} from "./settings";

const SAVE_DEBOUNCE_MS = 500;

function applyThemeCss(settings: ThemeSettings): void {
  const el = document.getElementById("custom-theme");
  if (el) el.textContent = themeSettingsToCss(settings);
}

export function ConfigCanvasView() {
  const paneRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const [catalog, setCatalog] = useState<ConfigEntry[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [spec, setSpec] = useState<ConfigViewSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [userMemory, setUserMemory] = useState<Record<string, string>>({});

  const [dictionaryModalOpen, setDictionaryModalOpen] = useState(false);
  const [editingDictionaryFrom, setEditingDictionaryFrom] = useState<string | null>(null);
  const [dictionaryFromDraft, setDictionaryFromDraft] = useState("");
  const [dictionaryToDraft, setDictionaryToDraft] = useState("");

  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateTitleDraft, setTemplateTitleDraft] = useState("");
  const [templateDescriptionDraft, setTemplateDescriptionDraft] = useState("");
  const [templateContentDraft, setTemplateContentDraft] = useState("");

  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [editingMemoryKey, setEditingMemoryKey] = useState<string | null>(null);
  const [memoryTitleDraft, setMemoryTitleDraft] = useState("");
  const [memoryDetailDraft, setMemoryDetailDraft] = useState("");

  const pendingSaves = useRef<Map<string, unknown>>(new Map());
  const saveTimer = useRef<number | null>(null);
  const headerScrolled = useScrolledHeader(scrollRef);

  const catalogById = useMemo(() => new Map(catalog.map((e) => [e.id, e])), [catalog]);

  const refreshAll = useCallback(async () => {
    const [cat, vals, view, mem] = await Promise.all([
      window.electron.config.getCatalog(),
      window.electron.config.getValues(),
      window.electron.config.getView(),
      window.electron.memory.getUserMemory(),
    ]);
    setCatalog(cat);
    setValues(vals);
    setSpec(view);
    setUserMemory(mem);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await refreshAll();
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshAll]);

  useEffect(() => {
    const unsub = window.electron.customization.onUpdated(() => {
      void window.electron.customization.getThemeSettings().then((theme) => {
        applyThemeCss(theme);
      });
    });
    return unsub;
  }, []);

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

  const flushSaves = useCallback(async () => {
    const batch = new Map(pendingSaves.current);
    pendingSaves.current.clear();
    let next = values;
    for (const [id, value] of batch) {
      next = await window.electron.config.setValue(id, value);
    }
    setValues(next);
    const themeEntry = batch.keys().some((id) => id.startsWith("theme."));
    if (themeEntry) {
      const theme = await window.electron.customization.getThemeSettings();
      applyThemeCss(theme);
    }
  }, [values]);

  const queueSave = useCallback(
    (id: string, value: unknown) => {
      setValues((prev) => ({ ...prev, [id]: value }));
      pendingSaves.current.set(id, value);
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void flushSaves();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSaves],
  );

  const saveImmediate = useCallback(async (id: string, value: unknown) => {
    const next = await window.electron.config.setValue(id, value);
    setValues(next);
    if (id.startsWith("theme.")) {
      const theme = await window.electron.customization.getThemeSettings();
      applyThemeCss(theme);
    }
  }, []);

  const handleGenerate = async () => {
    const message = composerText.trim();
    if (!message || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await window.electron.config.generateView(message, spec);
      setSpec(result.spec);
      setComposerText("");
      if (result.error) setGenerateError(result.error);
      await refreshAll();
    } catch (err) {
      setGenerateError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleGenerate();
    }
  };

  const dictionary = (values["transcription.dictionary"] as TranscriptDictionaryEntry[] | undefined) ?? [];
  const noteTemplates =
    (values["notes.templates"] as NoteTemplateConfig[] | undefined) ??
    normalizeNoteTemplates(undefined);

  const saveDictionary = async (next: TranscriptDictionaryEntry[]) => {
    await saveImmediate("transcription.dictionary", next);
  };

  const saveTemplates = async (next: NoteTemplateConfig[]) => {
    await saveImmediate("notes.templates", next);
  };

  const renderControl = (entry: ConfigEntry, inListBlock = false) => {
    const value = values[entry.id];
    const fieldId = `config-${entry.id.replace(/\./g, "-")}`;

    if (entry.control === "switch") {
      return (
        <div key={entry.id}>
          <SettingsSwitch
            id={fieldId}
            label={entry.label}
            checked={Boolean(value)}
            onChange={(e) => void saveImmediate(entry.id, e.target.checked)}
          />
          {entry.description ? <SettingsHint flush>{entry.description}</SettingsHint> : null}
        </div>
      );
    }

    if (entry.control === "select") {
      const strVal = value == null ? "" : String(value);
      return (
        <SettingsField key={entry.id} label={entry.label} htmlFor={fieldId}>
          {entry.description ? <SettingsHint flush>{entry.description}</SettingsHint> : null}
          <select
            id={fieldId}
            className="settings-select"
            value={strVal}
            onChange={(e) => void saveImmediate(entry.id, e.target.value)}
          >
            {(entry.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </SettingsField>
      );
    }

    if (entry.control === "color") {
      const hex = typeof value === "string" ? value : "#000000";
      return (
        <SettingsField key={entry.id} label={entry.label} htmlFor={fieldId}>
          {entry.description ? <SettingsHint flush>{entry.description}</SettingsHint> : null}
          <input
            id={fieldId}
            type="color"
            className="settings-color-input"
            value={normalizeColorPickerValue(parseHexColor(hex) ?? hex)}
            onChange={(e) => void saveImmediate(entry.id, e.target.value)}
          />
        </SettingsField>
      );
    }

    if (entry.control === "secret") {
      const shown = showSecrets[entry.id] ?? false;
      return (
        <SettingsField key={entry.id} label={entry.label} htmlFor={fieldId}>
          {entry.description ? <SettingsHint flush>{entry.description}</SettingsHint> : null}
          <div className="settings-secret-row">
            <input
              id={fieldId}
              type={shown ? "text" : "password"}
              className="settings-text-input"
              value={typeof value === "string" ? value : ""}
              onChange={(e) => queueSave(entry.id, e.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className="btn btn-icon settings-secret-toggle"
              onClick={() => setShowSecrets((s) => ({ ...s, [entry.id]: !shown }))}
              aria-label={shown ? "Hide" : "Show"}
            >
              {shown ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </SettingsField>
      );
    }

    if (entry.control === "textarea") {
      return (
        <SettingsField key={entry.id} label={entry.label} htmlFor={fieldId}>
          {entry.description ? <SettingsHint flush>{entry.description}</SettingsHint> : null}
          <textarea
            id={fieldId}
            className="settings-textarea"
            rows={4}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => queueSave(entry.id, e.target.value)}
          />
        </SettingsField>
      );
    }

    if (entry.control === "folder") {
      const path = typeof value === "string" ? value : "";
      return (
        <SettingsField key={entry.id} label={entry.label} htmlFor={fieldId}>
          {entry.description ? <SettingsHint flush>{entry.description}</SettingsHint> : null}
          <div className="settings-folder-row">
            <span className="settings-folder-path">{path || "Not set"}</span>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const picked = await window.electron.sync.pickFolder();
                if (picked) await saveImmediate(entry.id, picked);
              }}
            >
              Choose folder
            </button>
          </div>
        </SettingsField>
      );
    }

    if (entry.control === "list" && entry.listKind === "dictionary") {
      const block = (
        <>
          {!inListBlock && entry.description ? <SettingsHint>{entry.description}</SettingsHint> : null}
          {dictionary.length === 0 && <SettingsHint>No dictionary entries yet.</SettingsHint>}
          {dictionary.map((row) => (
            <SettingsEntryRow
              key={row.from}
              title={row.from}
              detail={row.to || "—"}
              onEdit={() => {
                setEditingDictionaryFrom(row.from);
                setDictionaryFromDraft(row.from);
                setDictionaryToDraft(row.to);
                setDictionaryModalOpen(true);
              }}
              onDelete={() => void saveDictionary(dictionary.filter((d) => d.from !== row.from))}
            />
          ))}
          <button
            type="button"
            className="btn settings-add-row-btn"
            onClick={() => {
              setEditingDictionaryFrom(null);
              setDictionaryFromDraft("");
              setDictionaryToDraft("");
              setDictionaryModalOpen(true);
            }}
          >
            Add entry
          </button>
        </>
      );
      if (inListBlock) return block;
      return (
        <SettingsGroup key={entry.id} title={entry.label} description={entry.description}>
          {block}
        </SettingsGroup>
      );
    }

    if (entry.control === "list" && entry.listKind === "noteTemplates") {
      const block = (
        <>
          {noteTemplates.map((t) => (
            <SettingsEntryRow
              key={t.id}
              title={t.title}
              detail={normalizeNoteTemplateDescription(t.description)}
              onEdit={() => {
                setEditingTemplateId(t.id);
                setTemplateTitleDraft(t.title);
                setTemplateDescriptionDraft(t.description ?? "");
                setTemplateContentDraft(t.content);
                setTemplatesModalOpen(true);
              }}
              onDelete={() => void saveTemplates(noteTemplates.filter((x) => x.id !== t.id))}
            />
          ))}
          <button
            type="button"
            className="btn settings-add-row-btn"
            onClick={() => {
              setEditingTemplateId(null);
              setTemplateTitleDraft("");
              setTemplateDescriptionDraft("");
              setTemplateContentDraft("");
              setTemplatesModalOpen(true);
            }}
          >
            Add template
          </button>
        </>
      );
      if (inListBlock) return block;
      return (
        <SettingsGroup key={entry.id} title={entry.label} description={entry.description}>
          {block}
        </SettingsGroup>
      );
    }

    if (entry.control === "list" && entry.listKind === "memory") {
      const keys = Object.keys(userMemory).sort();
      const block = (
        <>
          {keys.length === 0 && <SettingsHint>No user facts stored yet.</SettingsHint>}
          {keys.map((key) => (
            <SettingsEntryRow
              key={key}
              title={key}
              detail={userMemory[key] ?? ""}
              onEdit={() => {
                setEditingMemoryKey(key);
                setMemoryTitleDraft(key);
                setMemoryDetailDraft(userMemory[key] ?? "");
                setMemoryModalOpen(true);
              }}
              onDelete={async () => {
                await window.electron.memory.deleteUserMemoryKey(key);
                setUserMemory(await window.electron.memory.getUserMemory());
              }}
            />
          ))}
          <button
            type="button"
            className="btn settings-add-row-btn"
            onClick={() => {
              setEditingMemoryKey(null);
              setMemoryTitleDraft("");
              setMemoryDetailDraft("");
              setMemoryModalOpen(true);
            }}
          >
            Add fact
          </button>
        </>
      );
      if (inListBlock) return block;
      return (
        <SettingsGroup key={entry.id} title={entry.label} description={entry.description}>
          {block}
        </SettingsGroup>
      );
    }

    return (
      <SettingsField key={entry.id} label={entry.label} htmlFor={fieldId}>
        {entry.description ? <SettingsHint flush>{entry.description}</SettingsHint> : null}
        <input
          id={fieldId}
          type="text"
          className="settings-text-input"
          value={value == null ? "" : String(value)}
          onChange={(e) => queueSave(entry.id, e.target.value)}
        />
      </SettingsField>
    );
  };

  return (
    <div ref={paneRef} className="workspace-page tasks-page config-canvas-page" data-testid="config-canvas">
      <WorkspaceHeader
        title={spec?.title ?? "Config"}
        icon={<SettingsIcon size={18} />}
        scrolled={headerScrolled}
      />
      <div ref={scrollRef} className="workspace-scroll tasks-scroll">
        <div className="workspace-content tasks-content config-canvas-content">
          {loading && <p className="config-canvas-status">Loading…</p>}
          {!loading && generateError && (
            <p className="config-canvas-error" role="alert">
              {generateError}
            </p>
          )}
          {!loading && spec && (
            <SettingsSwitchProvider animationsReady>
              {spec.sections.map((section) => (
                <SettingsGroup key={section.title} title={section.title} description={section.lead}>
                  {section.entryIds.map((id) => {
                    const entry = catalogById.get(id);
                    if (!entry) return null;
                    if (entry.control === "list") {
                      return (
                        <div key={entry.id} className="config-canvas-list-block">
                          <h4 className="config-canvas-list-title">{entry.label}</h4>
                          {renderControl(entry, true)}
                        </div>
                      );
                    }
                    return renderControl(entry);
                  })}
                </SettingsGroup>
              ))}
            </SettingsSwitchProvider>
          )}
        </div>
      </div>

      <div ref={composerRef} className="tasks-composer-dock" data-testid="config-composer">
        <div className="chat-composer-inner">
          <textarea
            className="chat-input"
            placeholder="Describe what you want to configure…"
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            onKeyDown={onComposerKeyDown}
            rows={1}
            disabled={generating}
          />
          <div className="input-actions">
            <button
              type="button"
              className="chat-pane-btn chat-pane-btn--primary"
              onClick={() => void handleGenerate()}
              disabled={generating || !composerText.trim()}
            >
              {generating ? "Generating…" : "Apply"}
            </button>
          </div>
        </div>
      </div>

      <Modal
        open={dictionaryModalOpen}
        onClose={() => setDictionaryModalOpen(false)}
        title={editingDictionaryFrom ? "Edit dictionary entry" : "Add dictionary entry"}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const from = dictionaryFromDraft.trim();
              const to = dictionaryToDraft.trim();
              if (!from) return;
              const without = dictionary.filter((d) => d.from !== editingDictionaryFrom && d.from !== from);
              void saveDictionary([...without, { from, to }]);
              setDictionaryModalOpen(false);
            }}
          >
            Save
          </button>
        }
      >
        <SettingsField label="Heard as" htmlFor="dict-from">
          <input
            id="dict-from"
            className="settings-text-input"
            value={dictionaryFromDraft}
            onChange={(e) => setDictionaryFromDraft(e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Replace with" htmlFor="dict-to">
          <input
            id="dict-to"
            className="settings-text-input"
            value={dictionaryToDraft}
            onChange={(e) => setDictionaryToDraft(e.target.value)}
          />
        </SettingsField>
      </Modal>

      <Modal
        open={templatesModalOpen}
        onClose={() => setTemplatesModalOpen(false)}
        title={editingTemplateId ? "Edit template" : "Add template"}
        variant="scrollable"
        footer={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const title = templateTitleDraft.trim();
              if (!title) return;
              const id = editingTemplateId ?? `tpl_${Date.now()}`;
              const next = noteTemplates.filter((t) => t.id !== id);
              next.push({
                id,
                title,
                description: templateDescriptionDraft.trim() || undefined,
                content: templateContentDraft,
              });
              void saveTemplates(normalizeNoteTemplates(next));
              setTemplatesModalOpen(false);
            }}
          >
            Save
          </button>
        }
      >
        <SettingsField label="Title" htmlFor="tpl-title">
          <input
            id="tpl-title"
            className="settings-text-input"
            value={templateTitleDraft}
            onChange={(e) => setTemplateTitleDraft(e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Description" htmlFor="tpl-desc">
          <input
            id="tpl-desc"
            className="settings-text-input"
            value={templateDescriptionDraft}
            onChange={(e) => setTemplateDescriptionDraft(e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Content" htmlFor="tpl-content">
          <textarea
            id="tpl-content"
            className="settings-textarea"
            rows={8}
            value={templateContentDraft}
            onChange={(e) => setTemplateContentDraft(e.target.value)}
          />
        </SettingsField>
      </Modal>

      <Modal
        open={memoryModalOpen}
        onClose={() => setMemoryModalOpen(false)}
        title={editingMemoryKey ? "Edit fact" : "Add fact"}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              const key = memoryTitleDraft.trim();
              if (!key) return;
              if (editingMemoryKey && editingMemoryKey !== key) {
                await window.electron.memory.deleteUserMemoryKey(editingMemoryKey);
              }
              await window.electron.memory.setUserMemory(key, memoryDetailDraft.trim());
              setUserMemory(await window.electron.memory.getUserMemory());
              setMemoryModalOpen(false);
            }}
          >
            Save
          </button>
        }
      >
        <SettingsField label="Title" htmlFor="mem-title">
          <input
            id="mem-title"
            className="settings-text-input"
            value={memoryTitleDraft}
            onChange={(e) => setMemoryTitleDraft(e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Detail" htmlFor="mem-detail">
          <textarea
            id="mem-detail"
            className="settings-textarea"
            rows={4}
            value={memoryDetailDraft}
            onChange={(e) => setMemoryDetailDraft(e.target.value)}
          />
        </SettingsField>
      </Modal>
    </div>
  );
}
