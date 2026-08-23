/**
 * Splits streaming markdown into stable completed blocks plus a trailing partial.
 * completed.join("") + trailing === content always holds.
 */

export interface StreamingMarkdownBlocks {
  completed: string[];
  trailing: string;
}

export function splitStreamingMarkdown(
  content: string,
  previous?: StreamingMarkdownBlocks | null
): StreamingMarkdownBlocks {
  if (previous && previous.completed.length > 0) {
    const prefix = previous.completed.join("");
    if (content.startsWith(prefix)) {
      let remainder = content.slice(prefix.length);
      const completed = [...previous.completed];

      if (previous.trailing === "" && remainder.length > 0) {
        const absorbed = absorbLeadingBlankLineSeparators(remainder);
        if (absorbed) {
          completed[completed.length - 1] += absorbed.text;
          remainder = absorbed.rest;
        }
      }

      const remainderSplit = splitStreamingMarkdownFull(remainder);
      return {
        completed: completed.concat(remainderSplit.completed),
        trailing: remainderSplit.trailing,
      };
    }
  }
  return splitStreamingMarkdownFull(content);
}

/** Include trailing partial as a final block (stream end). */
export function flushStreamingMarkdown(blocks: StreamingMarkdownBlocks): StreamingMarkdownBlocks {
  if (!blocks.trailing) return blocks;
  return {
    completed: [...blocks.completed, blocks.trailing],
    trailing: "",
  };
}

/** True when the UI should show at least one completed markdown block. */
export function hasVisibleStreamingBlocks(content: string, isStreaming: boolean): boolean {
  const split = splitStreamingMarkdown(content);
  const presented = isStreaming ? split : flushStreamingMarkdown(split);
  return presented.completed.length > 0;
}

function absorbLeadingBlankLineSeparators(text: string): { text: string; rest: string } | null {
  if (!text) return null;
  let index = 0;
  let absorbed = "";
  while (index < text.length) {
    const nl = text.indexOf("\n", index);
    const lineEnd = nl === -1 ? text.length : nl + 1;
    const line = text.slice(index, lineEnd);
    const body = line.endsWith("\n") ? line.slice(0, -1) : line;
    if (!isBlankLine(body)) break;
    absorbed += line;
    index = lineEnd;
  }
  if (!absorbed || index >= text.length) return null;
  return { text: absorbed, rest: text.slice(index) };
}

function splitStreamingMarkdownFull(content: string): StreamingMarkdownBlocks {
  if (!content) {
    return { completed: [], trailing: "" };
  }

  const segments = fenceAwareSegments(content);
  const last = segments[segments.length - 1];
  if (!last) {
    return { completed: [], trailing: "" };
  }

  if (segments.length === 1) {
    if (isClosedFenceBlock(last)) {
      return { completed: [last], trailing: "" };
    }
    return { completed: [], trailing: last };
  }

  const completed = segments.slice(0, -1);
  let trailing = last;

  while (completed.length > 0) {
    const block = completed[completed.length - 1]!;
    if (isClosedFenceBlock(block) || !hasUnbalancedInlineMarkers(block)) break;
    trailing = block + trailing;
    completed.pop();
  }

  if (isClosedFenceBlock(trailing)) {
    completed.push(trailing);
    trailing = "";
  }

  return { completed, trailing };
}

function fenceAwareSegments(content: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inFence = false;
  let lineStart = 0;

  while (lineStart < content.length) {
    const nl = content.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? content.length : nl + 1;
    const line = content.slice(lineStart, lineEnd);
    const lineBody = line.endsWith("\n") ? line.slice(0, -1) : line;

    if (isFenceDelimiter(lineBody)) {
      inFence = !inFence;
      current += line;
      lineStart = lineEnd;
      continue;
    }

    if (!inFence && isBlankLine(lineBody) && current.length > 0) {
      current += line;
      lineStart = lineEnd;
      while (lineStart < content.length) {
        const nextNl = content.indexOf("\n", lineStart);
        const nextEnd = nextNl === -1 ? content.length : nextNl + 1;
        const nextLine = content.slice(lineStart, nextEnd);
        const nextBody = nextLine.endsWith("\n") ? nextLine.slice(0, -1) : nextLine;
        if (isBlankLine(nextBody)) {
          current += nextLine;
          lineStart = nextEnd;
          continue;
        }
        break;
      }
      if (lineStart < content.length) {
        segments.push(current);
        current = "";
      }
      continue;
    }

    current += line;
    lineStart = lineEnd;
  }

  segments.push(current);
  return segments;
}

function isFenceDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("```")) return false;
  const afterTicks = trimmed.replace(/^`+/, "");
  return !afterTicks.includes("`");
}

function isBlankLine(line: string): boolean {
  return line.trim().length === 0;
}

export function isClosedFenceBlock(block: string): boolean {
  const lines = block.split("\n");
  const firstNonBlank = lines.find((l) => !isBlankLine(l));
  if (!firstNonBlank || !isFenceDelimiter(firstNonBlank)) return false;

  let fenceCount = 0;
  for (const line of lines) {
    if (isFenceDelimiter(line)) fenceCount += 1;
  }
  return fenceCount >= 2 && fenceCount % 2 === 0;
}

export function hasUnbalancedInlineMarkers(text: string): boolean {
  if (unbalancedMarkerCount("**", text)) return true;
  if (hasUnbalancedInlineBackticks(text)) return true;
  return false;
}

function unbalancedMarkerCount(marker: string, text: string): boolean {
  let count = 0;
  let index = 0;
  while (index < text.length) {
    const found = text.indexOf(marker, index);
    if (found === -1) break;
    count += 1;
    index = found + marker.length;
  }
  return count % 2 !== 0;
}

function hasUnbalancedInlineBackticks(text: string): boolean {
  let inlineTicks = 0;
  for (const line of text.split("\n")) {
    if (isFenceDelimiter(line)) continue;
    for (const ch of line) {
      if (ch === "`") inlineTicks += 1;
    }
  }
  return inlineTicks % 2 !== 0;
}
