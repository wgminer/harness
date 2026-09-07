import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown, FileText, Loader2, Plus, Wrench } from "lucide-react";
import { SettingsEntryRow } from "../settings/SettingsEntryRow";
import { ToolCallsCard } from "../ToolCallsCard";
import { MessageContent, Section, SettingsFrame } from "./storyHelpers";

function CardsGallery() {
  return (
    <div>
      <Section title="Document card pills" stack>
        <MessageContent>
          <div className="document-card">
            <button type="button" className="document-card__pill">
              <FileText size={18} aria-hidden />
              <span className="document-card__pill-text">
                <span className="document-card__pill-title">Quarterly plan</span>
                <span className="document-card__pill-meta">1.2k words · updated just now</span>
              </span>
            </button>
          </div>
          <div className="document-card">
            <button type="button" className="document-card__pill document-card__pill--streaming">
              <Loader2 size={18} className="document-card__pill-spinner" aria-hidden />
              <span className="document-card__pill-text">
                <span className="document-card__pill-title">Writing note…</span>
                <span className="document-card__pill-meta">Streaming</span>
              </span>
            </button>
          </div>
          <div className="document-card">
            <button type="button" className="document-card__pill document-card__pill--error">
              <FileText size={18} aria-hidden />
              <span className="document-card__pill-text">
                <span className="document-card__pill-title">Couldn&apos;t open note</span>
                <span className="document-card__pill-meta">Missing from disk</span>
              </span>
            </button>
          </div>
        </MessageContent>
      </Section>

      <Section title="Library search card" stack>
        <MessageContent>
          <ToolCallsCard
            toolCalls={[
              {
                toolName: "memory_search_conversations",
                payload: {
                  results: [
                    {
                      kind: "chat",
                      id: "conv_1",
                      title: "Financial planning",
                      activityAt: 1,
                      score: 20,
                      snippet: "re thinking about saving for school…",
                    },
                    {
                      kind: "chat",
                      id: "conv_2",
                      title: "Saving Run Data in Running App",
                      activityAt: 2,
                      score: 12,
                      snippet: "import CoreLocation",
                    },
                    {
                      kind: "note",
                      id: "note_1",
                      title: "Relocation checklist",
                      activityAt: 3,
                      score: 8,
                      snippet: "Relocation checklist",
                    },
                  ],
                },
              },
            ]}
            expanded
            onToggleExpanded={() => {}}
            onToolConfirm={() => {}}
            onOpenConversation={() => {}}
            onOpenNote={() => {}}
          />
        </MessageContent>
      </Section>

      <Section title="Tool calls card" stack>
        <div className="tool-card tool-card--approval">
          <div className="tool-card-row tool-card-row--preview tool-card-row--pending">
            <div className="tool-card-heading">
              <span className="tool-card-icon">
                <Wrench size={14} aria-hidden />
              </span>
              <span className="tool-card-label">ws_edit · src/renderer/base.css</span>
            </div>
            <div className="tool-card-preview">
              <pre className="tool-card-preview__code" aria-label="Diff preview">
                <span className="tool-card-preview__line tool-card-preview__line--meta">
                  --- a/src/renderer/base.css
                </span>
                <span className="tool-card-preview__line tool-card-preview__line--meta">
                  +++ b/src/renderer/base.css
                </span>
                <span className="tool-card-preview__line tool-card-preview__line--del">
                  -  --radius-md: 6px;
                </span>
                <span className="tool-card-preview__line tool-card-preview__line--add">
                  +  --radius-md: 8px;
                </span>
              </pre>
            </div>
            <span className="tool-card-actions">
              <button type="button" className="btn btn-sm btn-primary">
                Proceed
              </button>
              <button type="button" className="btn btn-sm">
                Cancel
              </button>
            </span>
          </div>
        </div>
        <div className="tool-card tool-card--compressed">
          <div className="tool-card-row">
            <button type="button" className="tool-card-summary-toggle" aria-expanded={false}>
              <span className="tool-card-heading">
                <span className="tool-card-icon">
                  <Wrench size={14} aria-hidden />
                </span>
                <span className="tool-card-label">3 tool actions</span>
              </span>
              <ChevronDown strokeWidth={2} size={16} aria-hidden />
            </button>
          </div>
        </div>
      </Section>

      <Section title="Settings entry rows" stack>
        <SettingsFrame>
          <div className="settings-entry-list">
            <SettingsEntryRow
              title="OpenAI"
              detail="sk-••••••••abcd"
              badge="Default"
              onEdit={() => {}}
              onDelete={() => {}}
              editAriaLabel="Edit OpenAI key"
              deleteAriaLabel="Delete OpenAI key"
            />
            <SettingsEntryRow
              title="Anthropic"
              detail="Configured"
              onEdit={() => {}}
              editAriaLabel="Edit Anthropic key"
              actionsOnHover={false}
            />
          </div>
        </SettingsFrame>
      </Section>

      <Section title="Memory rows" stack>
        <SettingsFrame>
          <div className="settings-memory-list">
            <div className="settings-memory-row">
              <div className="settings-memory-row__key">preferred_name</div>
              <div className="settings-memory-row__value">Will</div>
            </div>
            <div className="settings-memory-row">
              <div className="settings-memory-row__key">timezone</div>
              <div className="settings-memory-row__value">America/New_York</div>
            </div>
          </div>
        </SettingsFrame>
      </Section>

      <Section title="Template cards" stack>
        <SettingsFrame>
          <div className="settings-template-grid">
            <button type="button" className="settings-template-card">
              <div className="settings-template-card__header">
                <span className="settings-template-card__title">Meeting notes</span>
                <span className="settings-template-card__badge">3 uses</span>
              </div>
              <div className="settings-template-card__preview">
                # Meeting{"\n"}- Attendees:{"\n"}- Decisions:
              </div>
            </button>
            <button type="button" className="settings-template-card settings-template-card--add">
              <Plus size={16} aria-hidden />
              <span className="settings-template-card__add-label">Add template</span>
            </button>
          </div>
        </SettingsFrame>
      </Section>

      <Section title="Prompt layers" stack>
        <SettingsFrame>
          <div className="settings-prompt-stack" role="list">
            <div className="settings-prompt-stack__item" role="listitem">
              <div className="settings-prompt-layer settings-prompt-layer--open">
                <button type="button" className="settings-prompt-layer__header" aria-expanded>
                  <span className="settings-prompt-layer__index">1</span>
                  <span className="settings-prompt-layer__titles">
                    <span className="settings-prompt-layer__title">Shared</span>
                    <span className="settings-prompt-layer__source">Contract</span>
                  </span>
                  <span className="settings-prompt-layer__meta">
                    <span className="settings-prompt-layer__badge settings-prompt-layer__badge--size">
                      1.2 KB
                    </span>
                  </span>
                </button>
                <div className="settings-prompt-layer__body">
                  <pre className="settings-prompt-layer__pre">You are Harness…</pre>
                </div>
              </div>
            </div>
            <div className="settings-prompt-stack__item" role="listitem">
              <div className="settings-prompt-stack__connector" aria-hidden>
                <span className="settings-prompt-stack__plus">+</span>
              </div>
              <div className="settings-prompt-layer">
                <button type="button" className="settings-prompt-layer__header" aria-expanded={false}>
                  <span className="settings-prompt-layer__index">2</span>
                  <span className="settings-prompt-layer__titles">
                    <span className="settings-prompt-layer__title">Mode overlay</span>
                    <span className="settings-prompt-layer__source">Write</span>
                  </span>
                  <span className="settings-prompt-layer__meta">
                    <span className="settings-prompt-layer__badge">optional</span>
                  </span>
                </button>
              </div>
            </div>
            <div className="settings-prompt-stack__item" role="listitem">
              <div className="settings-prompt-stack__connector" aria-hidden>
                <span className="settings-prompt-stack__plus">+</span>
              </div>
              <div className="settings-prompt-layer settings-prompt-layer--skipped">
                <button type="button" className="settings-prompt-layer__header" aria-expanded={false}>
                  <span className="settings-prompt-layer__index">3</span>
                  <span className="settings-prompt-layer__titles">
                    <span className="settings-prompt-layer__title">Tools</span>
                    <span className="settings-prompt-layer__source">Skipped</span>
                  </span>
                  <span className="settings-prompt-layer__meta">
                    <span className="settings-prompt-layer__badge settings-prompt-layer__badge--empty">
                      empty
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </SettingsFrame>
      </Section>
    </div>
  );
}

const meta = {
  title: "UI/Cards",
  component: CardsGallery,
} satisfies Meta<typeof CardsGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
