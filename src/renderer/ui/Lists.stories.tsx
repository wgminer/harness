import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CheckLine,
  Circle,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Search,
  StickyNote,
} from "lucide-react";
import { useState } from "react";
import { WorkspaceListSearch } from "../WorkspaceListSearch";
import { Skeleton } from "../Skeleton";
import { Section } from "./storyHelpers";

function ListsGallery() {
  const [query, setQuery] = useState("");

  return (
    <div>
      <Section title="Workspace list search" stack>
        <div style={{ maxWidth: 360 }}>
          <WorkspaceListSearch
            value={query}
            onChange={setQuery}
            placeholder="Search notes…"
            aria-label="Search notes"
          />
        </div>
      </Section>

      <Section title="Sidebar conversation rows" stack>
        <div className="sidebar" style={{ width: 280, background: "var(--bg)", padding: "var(--space-2)" }}>
          <div className="sidebar-list">
            <div className="sidebar-item active">
              <MessageCircle size={14} className="sidebar-item-icon" aria-hidden />
              <span className="sidebar-item-title">Active conversation</span>
            </div>
            <div className="sidebar-item">
              <Loader2 size={14} className="sidebar-item-spinner" aria-hidden />
              <span className="sidebar-item-title">Processing…</span>
            </div>
            <div className="sidebar-item">
              <MessageCircle size={14} className="sidebar-item-icon" aria-hidden />
              <Skeleton className="ui-skeleton--sidebar-title" />
            </div>
            <div className="sidebar-item">
              <StickyNote size={14} className="sidebar-item-icon" aria-hidden />
              <span className="sidebar-item-title">Pinned note draft</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Search results" stack>
        <div style={{ maxWidth: 480 }}>
          <button type="button" className="search-result-item list-item-base">
            <Search size={16} className="search-result-item__icon" aria-hidden />
            <span className="search-result-item__body">
              <span className="search-result-title">
                How to <mark className="search-highlight">sync</mark> with iOS
              </span>
              <span className="search-result-snippet">
                Pairing uses a short code and QR so devices can…
              </span>
            </span>
          </button>
          <button type="button" className="search-result-item list-item-base">
            <ImageIcon size={16} className="search-result-item__icon" aria-hidden />
            <span className="search-result-item__body">
              <span className="search-result-title">Moodboard exploration</span>
              <span className="search-result-snippet">Image · yesterday</span>
            </span>
          </button>
        </div>
      </Section>

      <Section title="Tasks rows" stack>
        <div style={{ maxWidth: 520 }}>
          <div className="tasks-row-item">
            <div className="tasks-row">
              <button type="button" className="tasks-row-check" aria-label="Complete">
                <Circle size={18} />
              </button>
              <div className="tasks-row-body">
                <div className="tasks-row-title">Write release notes</div>
                <div className="tasks-row-subtext">Due Friday</div>
                <div className="tasks-row-tags">
                  <span className="tasks-tag">docs</span>
                  <span className="tasks-tag">release</span>
                </div>
              </div>
            </div>
          </div>
          <div className="tasks-row-item">
            <div className="tasks-row">
              <button type="button" className="tasks-row-check" aria-label="Completed">
                <CheckLine size={18} />
              </button>
              <div className="tasks-row-body">
                <div className="tasks-row-title tasks-row-title--done">Ship Storybook</div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Notes list items" stack>
        <div style={{ maxWidth: 360 }}>
          <button type="button" className="notes-surface__note-item">
            <span className="notes-surface__note-title">Architecture dump</span>
            <span className="notes-surface__note-meta">
              <span className="notes-surface__note-word-count">842 words</span>
              <span className="notes-surface__note-time">2h ago</span>
            </span>
          </button>
          <button type="button" className="notes-surface__template-card">
            <span className="notes-surface__template-title">Blank note</span>
            <span className="notes-surface__template-preview">Start from scratch</span>
          </button>
        </div>
      </Section>
    </div>
  );
}

const meta = {
  title: "UI/Lists",
  component: ListsGallery,
} satisfies Meta<typeof ListsGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
