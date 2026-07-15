import { useState, useEffect, useCallback } from "react";
import { LLM_CONTEXT_EXPORT_PROMPT } from "../../shared/memoryImport";

export function useMemorySettings() {
  const [userMemory, setUserMemory] = useState<Record<string, string>>({});
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const [editingMemoryKey, setEditingMemoryKey] = useState<string | null>(null);
  const [newMemTitle, setNewMemTitle] = useState("");
  const [newMemDetail, setNewMemDetail] = useState("");
  const [exportPromptOpen, setExportPromptOpen] = useState(false);
  const [llmImportDraft, setLlmImportDraft] = useState("");
  const [llmImportBusy, setLlmImportBusy] = useState(false);
  const [llmImportMessage, setLlmImportMessage] = useState<string | null>(null);

  useEffect(() => {
    void window.harness.memory.getUserMemory().then(setUserMemory);
  }, []);

  const closeMemoryModal = useCallback(() => {
    setMemoryModalOpen(false);
    setEditingMemoryKey(null);
    setNewMemTitle("");
    setNewMemDetail("");
  }, []);

  const openAddMemoryModal = useCallback(() => {
    setEditingMemoryKey(null);
    setNewMemTitle("");
    setNewMemDetail("");
    setMemoryModalOpen(true);
  }, []);

  const openEditMemoryModal = useCallback((key: string, detail: string) => {
    setEditingMemoryKey(key);
    setNewMemTitle(key);
    setNewMemDetail(detail);
    setMemoryModalOpen(true);
  }, []);

  const saveMemory = useCallback(async () => {
    if (!newMemTitle.trim()) return;
    const nextTitle = newMemTitle.trim();
    const nextDetail = newMemDetail.trim();
    if (editingMemoryKey && editingMemoryKey !== nextTitle) {
      await window.harness.memory.deleteUserMemoryKey(editingMemoryKey);
    }
    await window.harness.memory.setUserMemory(nextTitle, nextDetail);
    setUserMemory(await window.harness.memory.getUserMemory());
    closeMemoryModal();
  }, [closeMemoryModal, editingMemoryKey, newMemDetail, newMemTitle]);

  const deleteMemoryEntry = useCallback(async (key: string) => {
    await window.harness.memory.deleteUserMemoryKey(key);
    setUserMemory(await window.harness.memory.getUserMemory());
  }, []);

  const copyExportPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(LLM_CONTEXT_EXPORT_PROMPT);
      setLlmImportMessage("Export prompt copied to clipboard.");
    } catch {
      setLlmImportMessage("Could not copy to clipboard.");
    }
  }, []);

  const runLlmContextImport = useCallback(async () => {
    setLlmImportBusy(true);
    setLlmImportMessage(null);
    try {
      const response = await window.harness.memory.importLlmContext(llmImportDraft);
      if (response.ok) {
        const r = response.result;
        const parts = [`Added ${r.added}, updated ${r.updated}.`];
        if (r.importSource) parts.push(`Source: ${r.importSource}.`);
        if (r.truncated) parts.push("Export was truncated before processing.");
        setLlmImportMessage(parts.join(" "));
        setLlmImportDraft("");
        setUserMemory(await window.harness.memory.getUserMemory());
      } else {
        setLlmImportMessage(response.error);
      }
    } finally {
      setLlmImportBusy(false);
    }
  }, [llmImportDraft]);

  return {
    userMemory,
    memoryModalOpen,
    editingMemoryKey,
    newMemTitle,
    setNewMemTitle,
    newMemDetail,
    setNewMemDetail,
    exportPromptOpen,
    setExportPromptOpen,
    llmImportDraft,
    setLlmImportDraft,
    llmImportBusy,
    llmImportMessage,
    closeMemoryModal,
    openAddMemoryModal,
    openEditMemoryModal,
    saveMemory,
    deleteMemoryEntry,
    copyExportPrompt,
    runLlmContextImport,
  };
}
