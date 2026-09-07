import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Modal } from "../Modal";
import { SetupNoticeModal } from "../SetupNoticeModal";
import { Section } from "./storyHelpers";

function ModalChromeDemo() {
  const [open, setOpen] = useState(true);

  return (
    <div style={{ minHeight: 420 }}>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Open Modal
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Rename Chat"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
              Save
            </button>
          </>
        }
      >
        <label className="app-modal-field">
          <span className="app-modal-field__label">Title</span>
          <input className="app-modal-input" defaultValue="Product brainstorm" />
        </label>
      </Modal>
    </div>
  );
}

function ModalDangerDemo() {
  const [open, setOpen] = useState(true);

  return (
    <div style={{ minHeight: 360 }}>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Open Destructive
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete Task"
        footerClassName="app-modal-footer--spread"
        footer={
          <>
            <button type="button" className="btn btn-danger" onClick={() => setOpen(false)}>
              Delete
            </button>
            <div className="app-modal-footer-actions">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </>
        }
      >
        <p className="setup-notice-lead">This cannot be undone.</p>
      </Modal>
    </div>
  );
}

function SetupNoticeDemo() {
  const [open, setOpen] = useState(true);

  return (
    <div style={{ minHeight: 480 }}>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Open Setup Notice
      </button>
      <SetupNoticeModal
        open={open}
        onSaveApiKey={async () => {
          await new Promise((r) => setTimeout(r, 400));
          setOpen(false);
        }}
        onDismiss={() => setOpen(false)}
      />
    </div>
  );
}

function InlineChromeGallery() {
  return (
    <Section title="Inline modal panel (no backdrop)" stack>
      <div className="app-modal" style={{ position: "relative", maxWidth: 440 }}>
        <div className="app-modal-header">
          <h3 className="app-modal-heading">Inline chrome</h3>
        </div>
        <div className="app-modal-body">
          <p className="setup-notice-lead">Panel styles without the full-screen overlay.</p>
        </div>
        <div className="app-modal-footer">
          <button type="button" className="btn">
            Cancel
          </button>
          <button type="button" className="btn btn-primary">
            Save
          </button>
        </div>
      </div>
    </Section>
  );
}

const meta = {
  title: "UI/Modal",
  component: ModalChromeDemo,
} satisfies Meta<typeof ModalChromeDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <ModalChromeDemo />,
};

export const Destructive: Story = {
  render: () => <ModalDangerDemo />,
};

export const SetupNotice: Story = {
  render: () => <SetupNoticeDemo />,
};

export const InlineChrome: Story = {
  render: () => <InlineChromeGallery />,
};
