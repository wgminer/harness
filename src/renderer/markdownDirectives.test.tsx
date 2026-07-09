import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "./chatHelpers";

function render(content: string): string {
  return renderToStaticMarkup(<MarkdownContent content={content} />);
}

describe("markdown directives", () => {
  it("renders a tip callout", () => {
    const html = render(":::tip\nUse this directive.\n:::");
    expect(html).toContain("md-callout");
    expect(html).toContain("md-callout--tip");
    expect(html).toContain("Use this directive");
    expect(html).toContain("Tip");
  });

  it("supports all four callout variants", () => {
    for (const variant of ["note", "warning", "danger"]) {
      const html = render(`:::${variant}\nBody text.\n:::`);
      expect(html).toContain(`md-callout--${variant}`);
      expect(html).toContain("Body text");
    }
  });

  it("renders an inline chip with tone", () => {
    const html = render("Status: :chip[urgent]{tone=warn} here.");
    expect(html).toContain("md-chip");
    expect(html).toContain("md-chip--warn");
    expect(html).toContain("urgent");
  });

  it("falls back to neutral for an unknown chip tone", () => {
    const html = render("Status: :chip[ok]{tone=bogus} here.");
    expect(html).toContain("md-chip--neutral");
    expect(html).toContain("ok");
  });

  it("renders details with summary and body", () => {
    const html = render(':::details{summary="Sources"}\nThree links.\n:::');
    expect(html).toContain("<details");
    expect(html).toContain("md-details");
    expect(html).toContain("Sources");
    expect(html).toContain("Three links");
  });

  it("renders a link card and rejects bad URLs", () => {
    const good = render(
      ':::link{url="https://example.com/x" title="Example" desc="A site" site="example.com"}\n:::',
    );
    expect(good).toContain("md-link-card");
    expect(good).toContain("https://example.com/x");
    expect(good).toContain("Example");
    expect(good).toContain("A site");

    const bad = render(':::link{url="not a url"}\n:::');
    expect(bad).not.toContain("md-link-card");
  });

  it("renders option labels as static buttons without body text", () => {
    const html = render(
      [
        "::::options",
        ':::option{title="Redis"}',
        "Ignored body.",
        ":::",
        ':::option{title="Memory"}',
        ":::",
        "::::",
      ].join("\n"),
    );
    expect(html).toContain("md-options");
    expect(html).toContain("md-option-btn");
    expect(html).toContain("Redis");
    expect(html).toContain("Memory");
    expect(html).not.toContain("Ignored body");
    expect(html).not.toContain("Recommended");
  });

  it("renders a slide deck: shows the first slide and a nav for two slides", () => {
    const html = render(
      [
        "::::slides",
        ':::slide{layout=title title="Hi" subtitle="Sub"}',
        ":::",
        ':::slide{layout=bullets title="Wins"}',
        "- A",
        "- B",
        ":::",
        "::::",
      ].join("\n"),
    );
    expect(html).toContain("md-slides");
    expect(html).toContain("md-slide--title");
    expect(html).toContain("Hi");
    expect(html).toContain("Sub");
    expect(html).toContain("1 / 2");
    expect(html).toContain("md-slides__nav");
    expect(html).not.toContain("md-slide--bullets");
  });

  it("renders a bullets slide when first in the deck", () => {
    const html = render(
      [
        "::::slides",
        ':::slide{layout=bullets title="Wins"}',
        "- A",
        "- B",
        ":::",
        "::::",
      ].join("\n"),
    );
    expect(html).toContain("md-slide--bullets");
    expect(html).toContain("Wins");
    expect(html).toContain("<li>A</li>");
    expect(html).not.toContain("md-slides__nav");
  });

  it("renders a quote slide with attribution", () => {
    const html = render(
      [
        "::::slides",
        ':::slide{layout=quote attribution="— Lee"}',
        "Make it work, then make it fast.",
        ":::",
        "::::",
      ].join("\n"),
    );
    expect(html).toContain("md-slide--quote");
    expect(html).toContain("md-slide__quote");
    expect(html).toContain("Make it work");
    expect(html).toContain("— Lee");
  });

  it("intercepts ```mermaid code blocks into the lazy renderer", () => {
    const html = render("```mermaid\nflowchart LR\nA-->B\n```");
    expect(html).toContain("md-mermaid");
    expect(html).not.toMatch(/<pre[^>]*>\s*<code[^>]*language-mermaid/);
  });

  it("leaves non-mermaid fenced code blocks alone", () => {
    const html = render("```ts\nconst x = 1;\n```");
    expect(html).toContain("md-code-block");
    expect(html).toContain("<pre");
    expect(html).toContain("language-ts");
    expect(html).not.toContain("md-mermaid");
  });

  it("falls back gracefully for an unknown directive", () => {
    const html = render(":::madeupthing\nstill visible\n:::");
    expect(html).toContain("still visible");
    expect(html).toContain('data-unknown-directive="madeupthing"');
  });

  it("renders standard markdown (table, bold) alongside directives", () => {
    const html = render("Hello **world**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(html).toContain("<strong>world</strong>");
    expect(html).toContain("<table>");
  });
});
