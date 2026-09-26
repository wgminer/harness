import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDefaultNoteTemplate,
  normalizeDefaultNoteTemplateId,
  normalizeNoteTemplates,
  type NoteSummary,
} from "../../shared/writing";
import type { View } from "../sidebar/sidebarUtils";

export type OpenNoteRequest = {
  id: string;
  nonce: number;
  isNew?: boolean;
};

/** Notes list, active note, and cross-surface "open this note" requests. */
export function useNotesLibrary({
  setView,
  openNoteInStickyWindow,
}: {
  setView: (view: View) => void;
  openNoteInStickyWindow: boolean;
}) {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  /** Note id to open when entering Notes from chat message action, sidebar selection, or creation. */
  const [pendingOpenNoteRequest, setPendingOpenNoteRequest] = useState<OpenNoteRequest | null>(null);

  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  const activeNoteIdRef = useRef(activeNoteId);
  useEffect(() => { activeNoteIdRef.current = activeNoteId; }, [activeNoteId]);

  const loadNotesList = useCallback(async () => {
    setNotes(await window.harness.notes.list());
  }, []);

  useEffect(() => {
    void loadNotesList();
  }, [loadNotesList]);

  /** Opens a note in the main pane's Notes view (from chat, sidebar, or another window). */
  const openNoteInMain = useCallback((noteId: string, opts?: { isNew?: boolean }) => {
    setPendingOpenNoteRequest({ id: noteId, nonce: Date.now(), isNew: opts?.isNew ?? false });
    setView("notes");
    // Chat (and other surfaces) may create notes outside App state — refresh so the row appears.
    void loadNotesList();
  }, [loadNotesList, setView]);

  useEffect(() => {
    return window.harness.notes.onOpenInMain((noteId) => {
      openNoteInMain(noteId);
    });
  }, [openNoteInMain]);

  const createNewNote = useCallback(async () => {
    try {
      let templates = normalizeNoteTemplates(undefined);
      let defaultTemplateId = normalizeDefaultNoteTemplateId(undefined, templates);
      try {
        const settings = await window.harness.settings.get();
        templates = normalizeNoteTemplates(settings.notes?.templates);
        defaultTemplateId = normalizeDefaultNoteTemplateId(settings.notes?.defaultTemplateId, templates);
      } catch {
        // Fall back to built-in defaults when settings are unavailable.
      }
      const note = await window.harness.notes.create(
        undefined,
        getDefaultNoteTemplate(templates, defaultTemplateId).content,
      );
      setNotes((prev) =>
        [
          { id: note.id, title: note.title, updatedAt: note.updatedAt, createdAt: note.createdAt, wordCount: note.wordCount },
          ...prev,
        ].sort((a, b) => b.updatedAt - a.updatedAt)
      );
      if (openNoteInStickyWindow) {
        await window.harness.notes.openSticky(note.id);
        return;
      }
      openNoteInMain(note.id, { isNew: true });
    } catch (e) {
      console.error("Failed to create note", e);
    }
  }, [openNoteInStickyWindow, openNoteInMain]);

  const deleteNote = useCallback(async (id: string) => {
    const remaining = await window.harness.notes.delete(id);
    setNotes(remaining);
    if (activeNoteId === id) {
      setActiveNoteId(null);
      setPendingOpenNoteRequest(null);
    }
  }, [activeNoteId]);

  const clearPendingOpenNote = useCallback(() => {
    setPendingOpenNoteRequest(null);
  }, []);

  return {
    notes,
    setNotes,
    notesRef,
    activeNoteId,
    setActiveNoteId,
    activeNoteIdRef,
    pendingOpenNoteRequest,
    setPendingOpenNoteRequest,
    clearPendingOpenNote,
    loadNotesList,
    openNoteInMain,
    createNewNote,
    deleteNote,
  };
}
