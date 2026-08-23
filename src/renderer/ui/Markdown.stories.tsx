import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessageContent, Section } from "./storyHelpers";

function MarkdownGallery() {
  return (
    <MessageContent>
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

      <Section title="Assistant prose" stack>
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
