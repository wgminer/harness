import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Image as ImageIcon,
  ListTodo,
  MessageCircle,
  Pin,
  Search,
  Settings2,
  SquareArrowDownLeft,
  PanelLeft,
} from "lucide-react";
import { Section } from "./storyHelpers";

function ShellGallery() {
  return (
    <div>
      <Section title="App titlebar" stack>
        <header className="app-titlebar" style={{ paddingLeft: 16 }}>
          <button type="button" className="app-titlebar__sidebar-toggle" aria-label="Show sidebar">
            <PanelLeft size={16} strokeWidth={1.75} aria-hidden />
          </button>
          <div className="app-titlebar__title">Product brainstorm</div>
          <div className="app-titlebar__actions">
            <button type="button" className="app-titlebar__action" aria-label="Search">
              <Search size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <button
              type="button"
              className="app-titlebar__action"
              aria-label="Tasks"
              aria-pressed
            >
              <ListTodo size={16} strokeWidth={1.75} aria-hidden />
            </button>
            <button type="button" className="app-titlebar__action" aria-label="Settings">
              <Settings2 size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </header>
      </Section>

      <Section title="Workspace page chrome" stack>
        <div className="workspace-page" style={{ minHeight: 280, border: "1px solid var(--border-edge)" }}>
          <header className="workspace-header">
            <div className="workspace-header-inner">
              <div className="workspace-header-title-row">
                <h1 className="workspace-title">Notes</h1>
              </div>
            </div>
          </header>
          <div className="workspace-scroll">
            <div className="workspace-content">
              <div className="workspace-stack">
                <div className="workspace-section-label">Recent</div>
                <p style={{ margin: 0, color: "var(--fg-muted)", fontSize: "var(--font-size-caption)" }}>
                  Page shell used by notes, tasks, and search.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Sidebar button cluster" stack>
        <div className="sidebar" style={{ width: 280, padding: "var(--space-3)", background: "var(--bg)" }}>
          <div className="sidebar-buttons">
            <button type="button" className="btn sidebar-new-chat-btn">
              New Chat
            </button>
          </div>
        </div>
      </Section>

      <Section title="Sidebar new menu" stack>
        <div
          className="sidebar-new-menu"
          style={{ position: "relative", width: 220, background: "var(--bg-elevated)" }}
        >
          <button type="button" className="sidebar-new-menu-item">
            <span className="sidebar-new-menu-item__main">
              <MessageCircle size={14} className="sidebar-new-menu-item__icon" aria-hidden />
              New Chat
            </span>
            <span className="sidebar-new-menu-item__shortcut">⌘N</span>
          </button>
          <button type="button" className="sidebar-new-menu-item">
            <span className="sidebar-new-menu-item__main">
              <ImageIcon size={14} className="sidebar-new-menu-item__icon" aria-hidden />
              New Image
            </span>
          </button>
        </div>
      </Section>

      <Section title="Notes aside panel" stack>
        <div className="notes-aside-panel" style={{ maxWidth: 320, position: "relative" }}>
          <div className="notes-aside-panel__header">
            <div className="notes-aside-panel__title">Ask about selection</div>
            <button type="button" className="btn btn-icon-sm notes-aside-panel__close" aria-label="Close">
              ×
            </button>
          </div>
          <div className="notes-aside-panel__body">
            <textarea className="notes-aside-panel__textarea" rows={3} defaultValue="What should I cut?" />
            <textarea
              className="notes-aside-panel__textarea notes-aside-panel__textarea--output"
              rows={4}
              readOnly
              defaultValue="Suggested trim: remove the second paragraph…"
            />
          </div>
          <div className="notes-aside-panel__footer">
            <button type="button" className="btn btn-sm btn-outline">
              Insert
            </button>
            <button type="button" className="btn btn-sm btn-primary notes-aside-panel__footer-primary">
              Ask
            </button>
          </div>
        </div>
      </Section>

      <Section title="Windowed / sticky note chrome" stack>
        <div className="windowed-note" style={{ width: 280, minHeight: 160, position: "relative" }}>
          <div className="windowed-note__actions">
            <button type="button" className="btn btn-icon windowed-note__action" aria-label="Pop in">
              <SquareArrowDownLeft size={14} />
            </button>
            <button
              type="button"
              className="btn btn-icon windowed-note__action windowed-note__action--active"
              aria-label="Pin"
            >
              <Pin size={14} />
            </button>
          </div>
          <div className="windowed-note__status">Pinned</div>
        </div>
      </Section>

      <Section title="Image canvas shell" stack>
        <div className="image-canvas" style={{ minHeight: 240, border: "1px solid var(--border-edge)" }}>
          <div className="image-canvas__stage">
            <div className="image-canvas__placeholder">Generated image lands here</div>
          </div>
          <aside className="image-canvas__panel">
            <div className="image-canvas__panel-body">
              <textarea className="image-canvas__textarea" rows={3} defaultValue="A quiet desk at dusk" />
              <div className="image-canvas__segmented" role="group" aria-label="Generate mode">
                <button type="button" className="image-canvas__segment image-canvas__segment--active">
                  Draft
                </button>
                <button type="button" className="image-canvas__segment">
                  Final
                </button>
              </div>
            </div>
            <div className="image-canvas__panel-footer">
              <button type="button" className="btn btn-primary image-canvas__generate">
                Generate
              </button>
            </div>
          </aside>
        </div>
      </Section>

      <Section title="Hotkey recording overlay chrome" stack>
        <div className="hotkey-recording-overlay" style={{ position: "relative", minHeight: 160 }}>
          <div className="hotkey-recording-overlay__field" aria-hidden />
          <div className="hotkey-recording-overlay__actions">
            <button type="button" className="btn btn-primary">
              Stop
            </button>
            <button type="button" className="btn">
              Cancel
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}

const meta = {
  title: "UI/Shell",
  component: ShellGallery,
} satisfies Meta<typeof ShellGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
