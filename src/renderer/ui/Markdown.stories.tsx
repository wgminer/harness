import type { Meta, StoryObj } from "@storybook/react-vite";
import { MarkdownContent } from "../chat/chatHelpers";
import { MessageContent, Section } from "./storyHelpers";

function MarkdownGallery() {
  return (
    <MessageContent>
      <Section title="Details" stack>
        <details className="md-details" open>
          <summary className="md-details__summary">Expand for context</summary>
          <div className="md-details__body">
            <p>Collapsed by default in chat; open here for the catalog.</p>
          </div>
        </details>
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
