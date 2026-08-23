import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AlertOctagon,
  AlertTriangle,
  ExternalLink,
  Info,
  Lightbulb,
} from "lucide-react";
import { MarkdownContent } from "../chatHelpers";
import { MessageContent, Section } from "./storyHelpers";

function MarkdownGallery() {
  return (
    <MessageContent>
      <Section title="Callouts" stack>
        <aside className="md-callout md-callout--tip" role="note">
          <span className="md-callout__icon" aria-hidden>
            <Lightbulb size={14} />
          </span>
          <div className="md-callout__body">
            <div className="md-callout__title">Tip</div>
            <div className="md-callout__content">
              <p>Use callouts for short, scannable guidance.</p>
            </div>
          </div>
        </aside>
        <aside className="md-callout md-callout--note" role="note">
          <span className="md-callout__icon" aria-hidden>
            <Info size={14} />
          </span>
          <div className="md-callout__body">
            <div className="md-callout__title">Note</div>
            <div className="md-callout__content">
              <p>Neutral note with quieter chrome.</p>
            </div>
          </div>
        </aside>
        <aside className="md-callout md-callout--warning" role="note">
          <span className="md-callout__icon" aria-hidden>
            <AlertTriangle size={14} />
          </span>
          <div className="md-callout__body">
            <div className="md-callout__title">Warning</div>
            <div className="md-callout__content">
              <p>Something needs attention before continuing.</p>
            </div>
          </div>
        </aside>
        <aside className="md-callout md-callout--danger" role="note">
          <span className="md-callout__icon" aria-hidden>
            <AlertOctagon size={14} />
          </span>
          <div className="md-callout__body">
            <div className="md-callout__title">Danger</div>
            <div className="md-callout__content">
              <p>Destructive or irreversible action ahead.</p>
            </div>
          </div>
        </aside>
      </Section>

      <Section title="Chips">
        <span className="md-chip md-chip--info">info</span>
        <span className="md-chip md-chip--warn">warn</span>
        <span className="md-chip md-chip--danger">danger</span>
        <span className="md-chip md-chip--success">success</span>
        <span className="md-chip md-chip--neutral">neutral</span>
      </Section>

      <Section title="Details" stack>
        <details className="md-details" open>
          <summary className="md-details__summary">Expand for context</summary>
          <div className="md-details__body">
            <p>Collapsed by default in chat; open here for the catalog.</p>
          </div>
        </details>
      </Section>

      <Section title="Link card" stack>
        <a
          className="md-link-card"
          href="https://example.com/docs"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="md-link-card__site">
            <span className="md-link-card__site-text">example.com</span>
            <ExternalLink size={12} aria-hidden />
          </span>
          <span className="md-link-card__title">Getting started with Harness</span>
          <span className="md-link-card__desc">A short description under the title.</span>
        </a>
      </Section>

      <Section title="Options" stack>
        <div className="md-options">
          <button type="button" className="btn">
            Ship it
          </button>
          <button type="button" className="btn">
            Iterate
          </button>
          <span className="btn">Already chosen</span>
        </div>
      </Section>

      <Section title="Code block" stack>
        <div className="md-code-block">
          <div className="md-code-block__toolbar">
            <button type="button" className="md-code-block__btn">
              Copy
            </button>
          </div>
          <pre>
            <code className="hljs language-ts">{`const greeting = "hello";\nconsole.log(greeting);`}</code>
          </pre>
        </div>
      </Section>

      <Section title="Library citations" stack>
        <MarkdownContent
          content={[
            "Best hits:",
            "",
            "1. **Three-year financial and relocation planning** — mentions moving for schools.",
            "`/c/conv_1`",
            "2. **Relocation checklist** — the saved note.",
            "[Relocation checklist](/n/note_1)",
          ].join("\n")}
          libraryHits={[
            {
              kind: "chat",
              id: "conv_1",
              title: "Financial planning",
              activityAt: 1,
              score: 1,
            },
            {
              kind: "note",
              id: "note_1",
              title: "Relocation checklist",
              activityAt: 2,
              score: 1,
            },
          ]}
          onOpenConversation={() => {}}
          onOpenNote={() => {}}
        />
      </Section>

      <Section title="Assistant prose" stack>
        <div>
          <p>
            Regular paragraph with <strong>strong</strong> and <code>inline code</code>.
          </p>
          <ul>
            <li>
              <p>List item one</p>
            </li>
            <li>
              <p>List item two</p>
            </li>
          </ul>
        </div>
      </Section>
    </MessageContent>
  );
}

const meta = {
  title: "UI/Markdown",
  component: MarkdownGallery,
} satisfies Meta<typeof MarkdownGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
