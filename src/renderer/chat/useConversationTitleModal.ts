import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingLink } from "../../shared/types";

/** Conversation details modal: rename + linked dictation recordings. */
export function useConversationTitleModal({
  conversationId,
  displayTitle,
  openTitleModalNonce,
  mirrorGlobalFnRecording,
  onTitleSaved,
}: {
  conversationId: string | null;
  displayTitle: string;
  /** Parent bumps this when the window title is clicked. */
  openTitleModalNonce: number | undefined;
  mirrorGlobalFnRecording: boolean;
  onTitleSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [recordings, setRecordings] = useState<RecordingLink[]>([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);

  const openTitleModal = useCallback(() => {
    setTitleDraft(displayTitle);
    setRecordings([]);
    setRecordingsLoading(true);
    setOpen(true);
  }, [displayTitle]);

  const closeTitleModal = useCallback(() => {
    setOpen(false);
  }, []);

  const openTitleModalRef = useRef(openTitleModal);
  openTitleModalRef.current = openTitleModal;
  /** Seed to the current nonce so remounting ChatView does not reopen from a stale parent click. */
  const lastTitleModalNonceRef = useRef(openTitleModalNonce);

  useEffect(() => {
    if (openTitleModalNonce == null || openTitleModalNonce < 1) return;
    if (lastTitleModalNonceRef.current === openTitleModalNonce) return;
    lastTitleModalNonceRef.current = openTitleModalNonce;
    openTitleModalRef.current();
  }, [openTitleModalNonce]);

  useEffect(() => {
    if (mirrorGlobalFnRecording) return;
    setOpen(false);
  }, [mirrorGlobalFnRecording]);

  useEffect(() => {
    if (!open || !conversationId) {
      if (!open) {
        setRecordings([]);
        setRecordingsLoading(false);
      }
      return;
    }

    let cancelled = false;
    void window.harness.memory
      .getConversationRecordings(conversationId)
      .then((result) => {
        if (cancelled) return;
        setRecordings(result.recordings ?? []);
        setRecordingsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setRecordings([]);
        setRecordingsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  const save = useCallback(async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || !conversationId) return;
    setSaving(true);
    try {
      await window.harness.memory.setConversationTitle(conversationId, trimmed);
      onTitleSaved();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }, [titleDraft, conversationId, onTitleSaved]);

  const showRecordingInFinder = useCallback((path: string) => {
    void window.harness.recording.showInFolder(path);
  }, []);

  return {
    open,
    closeTitleModal,
    titleDraft,
    setTitleDraft,
    saving,
    save,
    recordings,
    recordingsLoading,
    showRecordingInFinder,
  };
}
