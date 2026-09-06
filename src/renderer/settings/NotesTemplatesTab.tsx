import { useState } from "react";
import { Plus, Square, SquareCheck } from "lucide-react";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
  NOTE_TEMPLATE_CURSOR_TOKEN,
  NOTE_TEMPLATE_TODAY_TOKEN,
  isBuiltInNoteTemplateId,
  normalizeDefaultNoteTemplateId,
  normalizeNoteTemplates,
  type NoteTemplateConfig,
} from "../../shared/writing";
import { Modal } from "../Modal";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsTabPanel } from "./SettingsTabPanel";

export interface NotesTemplatesTabProps {
  noteTemplates: NoteTemplateConfig[];
  defaultNoteTemplateId: string;
  onTemplatesChange: (
    nextTemplates: NoteTemplateConfig[],
    nextDefaultId: string,
  ) => void | Promise<void>;
}

export function NotesTemplatesTab({
  noteTemplates,
  defaultNoteTemplateId,
  onTemplatesChange,
}: NotesTemplatesTabProps) {
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateTitleDraft, setTemplateTitleDraft] = useState("");
  const [templateContentDraft, setTemplateContentDraft] = useState("");
  const [templateIsDefaultDraft, setTemplateIsDefaultDraft] = useState(false);

  const closeTemplatesModal = () => {
    setTemplatesModalOpen(false);
    setEditingTemplateId(null);
    setTemplateTitleDraft("");
    setTemplateContentDraft("");
    setTemplateIsDefaultDraft(false);
  };

  const openCreateTemplateModal = () => {
    setEditingTemplateId(null);
    setTemplateTitleDraft("");
    setTemplateContentDraft("");
    setTemplateIsDefaultDraft(false);
    setTemplatesModalOpen(true);
  };

  const openTemplateModal = (template: NoteTemplateConfig) => {
    setEditingTemplateId(template.id);
    setTemplateTitleDraft(template.title);
    setTemplateContentDraft(template.content);
    setTemplateIsDefaultDraft(template.id === defaultNoteTemplateId);
    setTemplatesModalOpen(true);
  };

  const persistTemplates = async (
    nextTemplates: NoteTemplateConfig[],
    nextDefaultId: string,
  ) => {
    const normalized = normalizeNoteTemplates(nextTemplates);
    const resolvedDefaultId = normalizeDefaultNoteTemplateId(nextDefaultId, normalized);
    await onTemplatesChange(normalized, resolvedDefaultId);
  };

  const saveTemplate = async () => {
    const nextTitle = templateTitleDraft.trim();
    if (!nextTitle) return;

    if (editingTemplateId) {
      const nextTemplates = noteTemplates.map((template) =>
        template.id === editingTemplateId
          ? {
              ...template,
              title: nextTitle,
              content: templateContentDraft,
            }
          : template,
      );
      const nextDefaultId = templateIsDefaultDraft ? editingTemplateId : defaultNoteTemplateId;
      await persistTemplates(nextTemplates, nextDefaultId);
    } else {
      const newId = crypto.randomUUID();
      const nextTemplates = [
        ...noteTemplates,
        { id: newId, title: nextTitle, content: templateContentDraft },
      ];
      const nextDefaultId = templateIsDefaultDraft ? newId : defaultNoteTemplateId;
      await persistTemplates(nextTemplates, nextDefaultId);
    }
    closeTemplatesModal();
  };

  const deleteTemplate = async () => {
    if (!editingTemplateId || isBuiltInNoteTemplateId(editingTemplateId)) return;
    const nextTemplates = noteTemplates.filter((template) => template.id !== editingTemplateId);
    const nextDefaultId =
      defaultNoteTemplateId === editingTemplateId
        ? DEFAULT_NOTE_TEMPLATE_ID
        : defaultNoteTemplateId;
    await persistTemplates(nextTemplates, nextDefaultId);
    closeTemplatesModal();
  };

  return (
    <>
      <SettingsTabPanel id="notes">
        <SettingsGroup title="Editor templates">
          <div className="settings-template-grid">
            {noteTemplates.map((template) => {
              const isDefault = template.id === defaultNoteTemplateId;
              const preview = template.content.replace(/\s+$/, "");
              return (
                <button
                  key={template.id}
                  type="button"
                  className="settings-template-card"
                  onClick={() => openTemplateModal(template)}
                  aria-label={`Edit ${template.title} template`}
                  data-testid={`settings-notes-template-card-${template.id}`}
                >
                  <div className="settings-template-card__header">
                    <span className="settings-template-card__title">{template.title}</span>
                    {isDefault ? (
                      <span className="settings-template-card__badge">Default</span>
                    ) : null}
                  </div>
                  <div className="settings-template-card__preview" aria-hidden>
                    {preview.length > 0 ? preview : "Empty"}
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              className="settings-template-card settings-template-card--add"
              onClick={openCreateTemplateModal}
              aria-label="Add template"
              data-testid="settings-notes-template-add"
            >
              <Plus size={24} strokeWidth={2} aria-hidden />
              <span className="settings-template-card__add-label">Add template</span>
            </button>
          </div>
        </SettingsGroup>
      </SettingsTabPanel>

      <Modal
        open={templatesModalOpen}
        onClose={closeTemplatesModal}
        title={editingTemplateId ? "Edit notes template" : "Add notes template"}
        data-testid="settings-notes-template-modal"
        footerClassName={
          editingTemplateId && !isBuiltInNoteTemplateId(editingTemplateId)
            ? "app-modal-footer--spread"
            : undefined
        }
        footer={
          <>
            {editingTemplateId && !isBuiltInNoteTemplateId(editingTemplateId) ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void deleteTemplate()}
                data-testid="settings-notes-template-delete"
              >
                Delete
              </button>
            ) : null}
            <div className="app-modal-footer-actions">
              <button type="button" className="btn" onClick={closeTemplatesModal}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveTemplate()}
                disabled={!templateTitleDraft.trim()}
              >
                Save
              </button>
            </div>
          </>
        }
      >
        <div className="app-modal-stack">
          <label className="app-modal-field">
            <span className="app-modal-field__label">Title</span>
            <input
              type="text"
              value={templateTitleDraft}
              onChange={(e) => setTemplateTitleDraft(e.target.value)}
              className="app-modal-input"
              autoComplete="off"
            />
          </label>
          <label className="app-modal-field">
            <span className="app-modal-field__label">Template body</span>
            <textarea
              value={templateContentDraft}
              onChange={(e) => setTemplateContentDraft(e.target.value)}
              className="app-modal-input app-modal-input--multiline settings-template-content-input"
              rows={10}
            />
            <p className="app-modal-field__hint">
              Use <code>{NOTE_TEMPLATE_TODAY_TOKEN}</code> for today&apos;s date and{" "}
              <code>{NOTE_TEMPLATE_CURSOR_TOKEN}</code> to place the cursor when the note opens.
            </p>
          </label>
          <label className="app-modal-check">
            <input
              type="checkbox"
              className="app-modal-check__input"
              checked={templateIsDefaultDraft}
              disabled={templateIsDefaultDraft && editingTemplateId === defaultNoteTemplateId}
              onChange={(e) => setTemplateIsDefaultDraft(e.target.checked)}
              data-testid="settings-notes-template-default"
            />
            <span className="app-modal-check__icon" aria-hidden>
              {templateIsDefaultDraft ? (
                <SquareCheck size={18} strokeWidth={2} />
              ) : (
                <Square size={18} strokeWidth={2} />
              )}
            </span>
            <span className="app-modal-check__text">Default for new notes</span>
          </label>
        </div>
      </Modal>
    </>
  );
}
