import type { Meta, StoryObj } from "@storybook/react-vite";
import { Search, Settings2, Trash2 } from "lucide-react";
import { MessageContent, Section } from "./storyHelpers";

function ButtonGallery() {
  return (
    <MessageContent>
      <Section title=".btn (default)">
        <button type="button" className="btn">
          Default
        </button>
        <button type="button" className="btn" disabled>
          Disabled
        </button>
      </Section>

      <Section title=".btn.btn-primary">
        <button type="button" className="btn btn-primary">
          Primary
        </button>
        <button type="button" className="btn btn-primary" disabled>
          Disabled
        </button>
      </Section>

      <Section title=".btn.btn-outline">
        <button type="button" className="btn btn-outline">
          Outline
        </button>
        <button type="button" className="btn btn-outline" disabled>
          Disabled
        </button>
      </Section>

      <Section title=".btn.btn-danger">
        <button type="button" className="btn btn-danger">
          Danger
        </button>
        <button type="button" className="btn btn-danger" disabled>
          Disabled
        </button>
      </Section>

      <Section title="Sizes">
        <button type="button" className="btn">
          Default
        </button>
        <button type="button" className="btn btn-compact">
          Compact
        </button>
        <button type="button" className="btn btn-sm">
          Small
        </button>
        <button type="button" className="btn btn-sm btn-outline">
          Small Outline
        </button>
        <button type="button" className="btn btn-sm btn-primary">
          Small Primary
        </button>
      </Section>

      <Section title="Icons">
        <button type="button" className="btn btn-icon" aria-label="Search">
          <Search size={16} />
        </button>
        <button type="button" className="btn btn-icon btn-primary" aria-label="Settings">
          <Settings2 size={16} />
        </button>
        <button type="button" className="btn btn-icon-sm" aria-label="Delete">
          <Trash2 size={14} />
        </button>
        <button type="button" className="btn btn-icon" disabled aria-label="Search disabled">
          <Search size={16} />
        </button>
      </Section>

      <Section title="Compare: quieter stocks">
        <button type="button" className="btn btn-outline">
          Outline
        </button>
        <button type="button" className="btn btn-compact">
          Compact
        </button>
        <button type="button" className="btn btn-sm btn-outline">
          Small Outline
        </button>
        <button type="button" className="btn">
          Default
        </button>
      </Section>
    </MessageContent>
  );
}

const meta = {
  title: "UI/Buttons",
  component: ButtonGallery,
} satisfies Meta<typeof ButtonGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
