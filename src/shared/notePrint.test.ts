import { describe, expect, it } from "vitest";
import { buildNotePrintHtml, escapeHtml } from "./notePrint";

describe("escapeHtml", () => {
  it("escapes characters with special meaning in HTML", () => {
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});

describe("buildNotePrintHtml", () => {
  it("escapes HTML in title and content", () => {
    const html = buildNotePrintHtml("My <title>", "<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<h1>My &lt;title&gt;</h1>");
  });

  it("uses Note when title is empty", () => {
    const html = buildNotePrintHtml("   ", "body");
    expect(html).toContain("<h1>Note</h1>");
  });

  it("includes letter page size in styles", () => {
    const html = buildNotePrintHtml("T", "x");
    expect(html).toContain("@page { size: letter; margin: 0.75in; }");
  });
});
