/** Escape text for safe inclusion in print HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Build a standalone HTML document for printing a note. */
export function buildNotePrintHtml(title: string, content: string): string {
  const safeTitle = escapeHtml(title.trim() || "Note");
  const safeContent = escapeHtml(content);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { size: letter; margin: 0.75in; }
  body { margin: 0; font-family: "IBM Plex Sans", sans-serif; color: #111; }
  h1 {
    font-size: 14pt;
    font-weight: 600;
    color: #444;
    margin: 0 0 12pt;
    line-height: 1.3;
  }
  pre {
    margin: 0;
    font-family: "IBM Plex Mono", monospace;
    font-size: 11pt;
    line-height: 1.4;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
</style>
</head>
<body>
<h1>${safeTitle}</h1>
<pre>${safeContent}</pre>
</body>
</html>`;
}
