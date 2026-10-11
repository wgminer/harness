/**
 * Retired assistant layout directives (`:::tip`, `:::note`, `:::warning`, `:::danger`,
 * `:::details`, `:::link`, `:chip[...]`). The model is no longer told about them, but old
 * messages still contain them, so they are flattened to plain markdown for display.
 * iOS mirrors this in `ChatDisplayText.swift`; keep its tests in step with
 * `fixtures/layoutDirectives.json`.
 */

const CONTAINER_OPEN_RE = /^:{3,}\s*(tip|note|warning|danger|details|link)\b\s*(\{.*\})?\s*$/i;
const FENCE_CLOSE_RE = /^:{3,}\s*$/;
const CODE_FENCE_RE = /^\s*(```|~~~)/;
const CHIP_RE = /:chip\[([^\]]*)\](?:\{[^}]*\})?/g;

function attribute(attrs: string, name: string): string {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return (match?.[1] ?? "").trim();
}

export function stripLayoutDirectives(markdown: string): string {
  if (!markdown || (!markdown.includes(":::") && !markdown.includes(":chip["))) return markdown;
  const out: string[] = [];
  let inCode = false;
  let changed = false;
  // A removed fence line leaves one blank line so the block stays its own paragraph.
  const pushBreak = () => {
    changed = true;
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
  };
  for (const line of markdown.split("\n")) {
    if (CODE_FENCE_RE.test(line)) {
      inCode = !inCode;
      out.push(line);
      continue;
    }
    if (inCode) {
      out.push(line);
      continue;
    }
    const open = line.match(CONTAINER_OPEN_RE);
    if (open) {
      const name = (open[1] ?? "").toLowerCase();
      const attrs = open[2] ?? "";
      pushBreak();
      if (name === "link") {
        const url = attribute(attrs, "url");
        if (url) {
          const desc = attribute(attrs, "desc");
          out.push(`[${attribute(attrs, "title") || url}](${url})${desc ? ` — ${desc}` : ""}`);
        }
      } else if (name === "details") {
        const summary = attribute(attrs, "summary");
        if (summary) out.push(`**${summary}**`, "");
      }
      continue;
    }
    if (FENCE_CLOSE_RE.test(line)) {
      pushBreak();
      continue;
    }
    const replaced = line.replace(CHIP_RE, "$1");
    if (replaced !== line) changed = true;
    out.push(replaced);
  }
  if (!changed) return markdown;
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}
