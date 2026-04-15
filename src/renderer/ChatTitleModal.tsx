import { Modal } from "./Modal";

interface ChatTitleModalProps {
  open: boolean;
  onClose: () => void;
  titleDraft: string;
  onTitleDraftChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function ChatTitleModal({
  open,
  onClose,
  titleDraft,
  onTitleDraftChange,
  onSave,
  saving,
}: ChatTitleModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Conversation title"
      closeDisabled={saving}
      footer={
        <>
          <button
            type="button"
            className="btn btn-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving || !titleDraft.trim()}
          >
            Save
          </button>
        </>
      }
    >
      <label htmlFor="chat-title-modal-input">Title</label>
      <input
        id="chat-title-modal-input"
        type="text"
        className="app-modal-input"
        value={titleDraft}
        onChange={(e) => onTitleDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSave();
          }
        }}
        autoFocus
      />
    </Modal>
  );
}
