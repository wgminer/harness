import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { Skeleton } from "../Skeleton";
import { Section } from "./storyHelpers";

const swatchGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
  gap: "var(--space-3)",
  width: "100%",
};

function Swatch({ name, color }: { name: string; color: string }) {
  return (
    <div
      title={name}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
    >
      <div
        style={{
          height: 48,
          borderRadius: "var(--radius-md)",
          background: color,
          border: "1px solid var(--border-edge)",
        }}
      />
      <code style={{ fontSize: "var(--font-size-ui)", color: "var(--fg-muted)" }}>{name}</code>
    </div>
  );
}

function FoundationsGallery() {
  return (
    <div>
      <Section title="Surfaces" stack>
        <div style={swatchGrid}>
          <Swatch name="--bg" color="var(--bg)" />
          <Swatch name="--bg-secondary" color="var(--bg-secondary)" />
          <Swatch name="--bg-elevated" color="var(--bg-elevated)" />
          <Swatch name="--hover-bg" color="var(--hover-bg)" />
          <Swatch name="--hover-bg-strong" color="var(--hover-bg-strong)" />
          <Swatch name="--overlay" color="var(--overlay)" />
        </div>
      </Section>

      <Section title="Accent & semantic" stack>
        <div style={swatchGrid}>
          <Swatch name="--accent" color="var(--accent)" />
          <Swatch name="--accent-readable" color="var(--accent-readable)" />
          <Swatch name="--accent-muted" color="var(--accent-muted)" />
          <Swatch name="--danger" color="var(--danger)" />
          <Swatch name="--warning" color="var(--warning)" />
          <Swatch name="--success" color="var(--success)" />
        </div>
      </Section>

      <Section title="Borders" stack>
        <div style={swatchGrid}>
          <Swatch name="--border-light" color="var(--border-light)" />
          <Swatch name="--border-input" color="var(--border-input)" />
          <Swatch name="--border-edge" color="var(--border-edge)" />
        </div>
      </Section>

      <Section title="Typography" stack>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div title="--font-size-page" style={{ fontSize: "var(--font-size-page)", fontWeight: 600 }}>
            Page · 28px
          </div>
          <div title="--font-size-title" style={{ fontSize: "var(--font-size-title)", fontWeight: 600 }}>
            Title · 18px
          </div>
          <div title="--font-size-body" style={{ fontSize: "var(--font-size-body)" }}>
            Body · 16px — The quick brown fox
          </div>
          <div
            title="--font-size-caption"
            style={{ fontSize: "var(--font-size-caption)", color: "var(--fg-muted)" }}
          >
            Caption · 12px muted
          </div>
          <div
            title="--font-size-ui / --font-family-mono"
            style={{
              fontSize: "var(--font-size-ui)",
              fontFamily: "var(--font-family-mono)",
              color: "var(--fg-muted)",
            }}
          >
            UI mono · 12px
          </div>
        </div>
      </Section>

      <Section title="Radius">
        {(
          [
            ["--radius-xs", "var(--radius-xs)"],
            ["--radius-sm", "var(--radius-sm)"],
            ["--radius-md", "var(--radius-md)"],
            ["--radius-lg", "var(--radius-lg)"],
            ["--radius-control", "var(--radius-control)"],
            ["--radius-pill", "var(--radius-pill)"],
          ] as const
        ).map(([name, radius]) => (
          <div
            key={name}
            style={{
              width: 56,
              height: 40,
              background: "var(--btn-bg)",
              border: "1px solid var(--border-input)",
              borderRadius: radius,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "var(--font-size-ui)",
              color: "var(--fg-muted)",
            }}
            title={name}
          >
            {name.replace("--radius-", "")}
          </div>
        ))}
      </Section>

      <Section title="Skeletons" stack>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 320 }}>
          <Skeleton className="ui-skeleton--title" label="Title" title="ui-skeleton--title" />
          <Skeleton
            className="ui-skeleton--prose-line"
            label="Prose line"
            title="ui-skeleton--prose-line"
          />
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <Skeleton className="ui-skeleton--play" title="ui-skeleton--play" />
            <Skeleton className="ui-skeleton--name" title="ui-skeleton--name" />
            <Skeleton className="ui-skeleton--num" title="ui-skeleton--num" />
          </div>
        </div>
      </Section>

      <Section title="Glass surface" stack>
        <div
          title="--accent over --bg-secondary"
          style={{
            padding: "var(--space-5)",
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--accent) 35%, var(--bg)), var(--bg-secondary))",
            borderRadius: "var(--radius-lg)",
          }}
        >
          <div
            className="surface-elevated-glass"
            title="surface-elevated-glass"
            style={{ padding: "var(--space-4)" }}
          >
            .surface-elevated-glass over a gradient
          </div>
        </div>
      </Section>

      <Section title="Divider">
        <hr title="hr" style={{ width: "100%" }} />
      </Section>

      <Section title="Boot wordmark" stack>
        <div className="harness-boot" title="harness-boot" style={{ minHeight: 120, position: "relative" }}>
          <span className="harness-boot__wordmark" title="harness-boot__wordmark">
            Harness
          </span>
        </div>
      </Section>
    </div>
  );
}

const meta = {
  title: "UI/Foundations",
  component: FoundationsGallery,
} satisfies Meta<typeof FoundationsGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};
