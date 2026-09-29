import { useCallback, useEffect, useRef, useState } from "react";
import { isNoteConflictError, type Note } from "../../shared/writing";

interface UseNoteExternalSyncOptions {
  noteId: string | null;
  /** Last content this editor loaded or saved. */
  getSavedContent: () => string;
  /** True when the editor holds unsaved edits. */
  isDirty: () => boolean;
  /** Replace the editor contents with a version written elsewhere. */
  applyRemote: (note: Note) => void;
}

/**
 * Keeps an open note editor in step with writes from chat tools, note streams,
 * and other windows. Clean editors reload silently; dirty editors get a
 * conflict to resolve instead of clobbering (or being clobbered by) the other
 * write.
 */
export function useNoteExternalSync({
  noteId,
  getSavedContent,
  isDirty,
  applyRemote,
}: UseNoteExternalSyncOptions) {
  // Version this editor last loaded or saved, keyed by note so a switch can't
  // inherit the previous note's version.
  const baseRef = useRef<{ id: string; updatedAt: number } | null>(null);
  const savingRef = useRef(false);
  const missedChangeRef = useRef(false);
  const [conflict, setConflict] = useState<Note | null>(null);

  const optionsRef = useRef({ getSavedContent, isDirty, applyRemote });
  optionsRef.current = { getSavedContent, isDirty, applyRemote };

  const baseUpdatedAt = useCallback(
    () => (baseRef.current && baseRef.current.id === noteId ? baseRef.current.updatedAt : null),
    [noteId],
  );
  const setBase = useCallback((note: Pick<Note, "id" | "updatedAt">) => {
    baseRef.current = { id: note.id, updatedAt: note.updatedAt };
  }, []);

  useEffect(() => {
    setConflict(null);
  }, [noteId]);

  const reconcile = useCallback(async () => {
    if (!noteId) return;
    const note = await window.harness.notes.read(noteId).catch(() => null);
    if (!note || note.id !== noteId) return;
    if (note.updatedAt === baseUpdatedAt()) return;
    const { getSavedContent: saved, isDirty: dirty, applyRemote: apply } = optionsRef.current;
    if (note.content === saved()) {
      setBase(note);
      return;
    }
    if (!dirty()) {
      setBase(note);
      setConflict(null);
      apply(note);
      return;
    }
    setConflict(note);
  }, [noteId, baseUpdatedAt, setBase]);

  useEffect(() => {
    if (!noteId) return;
    return window.harness.notes.onChanged((event) => {
      if (event.id !== noteId || event.deleted) return;
      if (event.updatedAt != null && event.updatedAt === baseUpdatedAt()) return;
      if (savingRef.current) {
        missedChangeRef.current = true;
        return;
      }
      void reconcile();
    });
  }, [noteId, reconcile, baseUpdatedAt]);

  /** Record the version the editor just loaded. */
  const markLoaded = setBase;

  /**
   * Save through the conflict guard. Resolves to the saved note, or `null` when
   * another writer got there first (the conflict bar then takes over).
   */
  const saveGuarded = useCallback(
    async (content: string): Promise<Note | null> => {
      if (!noteId) return null;
      savingRef.current = true;
      try {
        const expected = baseUpdatedAt() ?? undefined;
        const note = await window.harness.notes.save(noteId, content, {
          expectedUpdatedAt: expected,
        });
        setBase(note);
        return note;
      } catch (err) {
        if (!isNoteConflictError(err)) throw err;
        missedChangeRef.current = true;
        return null;
      } finally {
        savingRef.current = false;
        if (missedChangeRef.current) {
          missedChangeRef.current = false;
          void reconcile();
        }
      }
    },
    [noteId, reconcile, baseUpdatedAt, setBase],
  );

  const reloadFromConflict = useCallback(() => {
    if (!conflict) return;
    setBase(conflict);
    optionsRef.current.applyRemote(conflict);
    setConflict(null);
  }, [conflict, setBase]);

  /** Keep local edits; the next save deliberately replaces the other version. */
  const keepMine = useCallback(() => {
    if (!conflict) return;
    setBase(conflict);
    setConflict(null);
  }, [conflict, setBase]);

  return { conflict, markLoaded, saveGuarded, reloadFromConflict, keepMine };
}
