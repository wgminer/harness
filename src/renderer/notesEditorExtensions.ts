import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { RangeSetBuilder, Prec, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  adjustMarkdownListItemIndent,
  findListItemHeadForLine,
  getListContinuationPrefixForLine,
  getListSoftBreakPrefixForLine,
  isListItemContinuationLine,
  isMarkdownListItemLine,
  parseMarkdownHeadingLine,
  parseMarkdownListItemLine,
} from "../shared/writing";

function dispatchChange(
  view: EditorView,
  from: number,
  to: number,
  insert: string,
  selectionAnchor: number,
  selectionHead = selectionAnchor,
): void {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: selectionAnchor, head: selectionHead },
    scrollIntoView: true,
  });
}

function handleListEnter(view: EditorView, softBreak: boolean): boolean {
  const { from, to } = view.state.selection.main;
  if (from !== to) return false;
  const line = view.state.doc.lineAt(from);
  if (from !== line.to) return false;
  const continuation = softBreak
    ? getListSoftBreakPrefixForLine(line.text)
    : getListContinuationPrefixForLine(line.text);
  if (!continuation) return false;
  dispatchChange(view, from, to, `\n${continuation}`, from + 1 + continuation.length);
  return true;
}

function handleListTab(view: EditorView, outdent: boolean): boolean {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  const blockStart = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const blockEnd =
    from === to
      ? (() => {
          const lineEnd = doc.indexOf("\n", from);
          return lineEnd === -1 ? doc.length : lineEnd;
        })()
      : to;
  const block = doc.slice(blockStart, blockEnd);
  const listDirection = outdent ? "outdent" : "indent";
  const useListIndent =
    from === to ? isMarkdownListItemLine(block) : block.split("\n").some(isMarkdownListItemLine);

  if (useListIndent) {
    const adjusted = adjustMarkdownListItemIndent(block, listDirection);
    if (adjusted.changed) {
      const nextBlock = adjusted.block;
      if (from === to) {
        const caretDelta = listDirection === "indent" ? adjusted.deltaAtStart : -adjusted.deltaAtStart;
        const nextCaret = Math.max(blockStart, from + caretDelta);
        dispatchChange(view, blockStart, blockEnd, nextBlock, nextCaret);
      } else {
        const nextFrom = Math.max(
          blockStart,
          from + (listDirection === "indent" ? adjusted.deltaAtStart : -adjusted.deltaAtStart),
        );
        const nextTo = Math.max(
          blockStart,
          to + (listDirection === "indent" ? adjusted.deltaTotal : -adjusted.deltaTotal),
        );
        dispatchChange(view, blockStart, blockEnd, nextBlock, nextFrom, nextTo);
      }
      return true;
    }
    if (from === to) return true;
  }

  if (from === to) {
    if (outdent) {
      const lineStart = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
      if (doc[lineStart] !== "\t") return false;
      const nextDoc = `${doc.slice(0, lineStart)}${doc.slice(lineStart + 1)}`;
      const nextCaret = from > lineStart ? from - 1 : from;
      dispatchChange(view, 0, doc.length, nextDoc, nextCaret);
      return true;
    }
    dispatchChange(view, from, to, "\t", from + 1);
    return true;
  }

  const selectedBlockStart = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const selectedBlock = doc.slice(selectedBlockStart, to);
  if (outdent) {
    const unindentedBlock = selectedBlock.replace(/^\t/gm, "");
    const nextDoc = doc.slice(0, selectedBlockStart) + unindentedBlock + doc.slice(to);
    const removedAtStart = doc[selectedBlockStart] === "\t" ? 1 : 0;
    const removedTotal = selectedBlock.length - unindentedBlock.length;
    dispatchChange(
      view,
      0,
      doc.length,
      nextDoc,
      Math.max(selectedBlockStart, from - removedAtStart),
      Math.max(selectedBlockStart, to - removedTotal),
    );
    return true;
  }

  const indentedBlock = selectedBlock.replace(/^/gm, "\t");
  const nextDoc = doc.slice(0, selectedBlockStart) + indentedBlock + doc.slice(to);
  const addedTotal = indentedBlock.length - selectedBlock.length;
  dispatchChange(view, 0, doc.length, nextDoc, from + 1, to + addedTotal);
  return true;
}

const markdownListKeymap = keymap.of([
  {
    key: "Enter",
    run: (view) => handleListEnter(view, false),
  },
  {
    key: "Shift-Enter",
    run: (view) => handleListEnter(view, true),
  },
  {
    key: "Tab",
    run: (view) => handleListTab(view, false),
  },
  {
    key: "Shift-Tab",
    run: (view) => handleListTab(view, true),
  },
  ...defaultKeymap.filter((binding) => binding.key !== "Tab" && binding.key !== "Shift-Tab"),
  ...historyKeymap,
]);

type PendingDecoration = { from: number; to: number; decoration: Decoration };

function pushMarkerDecoration(pending: PendingDecoration[], from: number, length: number): void {
  if (length <= 0) return;
  pending.push({
    from,
    to: from + length,
    decoration: Decoration.mark({ class: "cm-md-marker" }),
  });
}

function listLineDecoration(lineText: string, lines: string[], lineIndex: number): Decoration | null {
  const parsed = parseMarkdownListItemLine(lineText);
  if (parsed) {
    const markerWidth = parsed.headPrefix.length;
    return Decoration.line({
      attributes: {
        class: "cm-md-list-item",
        style: `padding-left:${markerWidth}ch;text-indent:-${markerWidth}ch`,
      },
    });
  }

  if (isListItemContinuationLine(lines, lineIndex)) {
    const head = findListItemHeadForLine(lines, lineIndex);
    if (!head) return null;
    const prefix = lineText.startsWith(head.softPrefix)
      ? head.softPrefix
      : lineText.slice(0, lineText.length - lineText.trimStart().length);
    const width = prefix.length || head.softPrefix.length;
    return Decoration.line({
      attributes: {
        class: "cm-md-list-continuation",
        style: `padding-left:${width}ch`,
      },
    });
  }

  return null;
}

function buildMarkdownDecorations(view: EditorView): DecorationSet {
  const pending: PendingDecoration[] = [];
  const lines = view.state.doc.toString().split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = view.state.doc.line(index + 1);
    const text = line.text;
    const prevText = index > 0 ? lines[index - 1] : undefined;
    const sectionGap = prevText !== undefined && prevText.trim() !== "";

    const listLine = listLineDecoration(text, lines, index);
    if (listLine) {
      pending.push({ from: line.from, to: line.from, decoration: listLine });
      const parsed = parseMarkdownListItemLine(text);
      if (parsed) {
        pushMarkerDecoration(pending, line.from, parsed.headPrefix.length);
      }
      continue;
    }

    const heading = parseMarkdownHeadingLine(text);
    if (heading) {
      const classes = [`cm-md-h${heading.level}`];
      if (sectionGap) classes.push("cm-md-section-gap");
      pending.push({
        from: line.from,
        to: line.from,
        decoration: Decoration.line({ attributes: { class: classes.join(" ") } }),
      });
      pushMarkerDecoration(pending, line.from, heading.markerLength);
      continue;
    }

    const blockquoteMatch = text.match(/^(\s*)(>\s?)/);
    if (blockquoteMatch) {
      const markerLength = blockquoteMatch[1].length + blockquoteMatch[2].length;
      pending.push({
        from: line.from,
        to: line.from,
        decoration: Decoration.line({ attributes: { class: "cm-md-blockquote" } }),
      });
      pushMarkerDecoration(pending, line.from, markerLength);
    }
  }

  pending.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const entry of pending) {
    builder.add(entry.from, entry.to, entry.decoration);
  }
  return builder.finish();
}

const markdownStylePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMarkdownDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildMarkdownDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

export function createNotesCodeEditorTheme(): Extension {
  return EditorView.theme(
    {
      "&": {
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        backgroundColor: "transparent",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-scroller": {
        flex: "1 1 auto",
        minHeight: 0,
        overflow: "auto",
        fontFamily: "var(--font-family-mono)",
        fontSize: "var(--font-size)",
        lineHeight: "var(--line-height-prose)",
      },
      ".cm-content": {
        caretColor: "var(--fg)",
        color: "var(--fg)",
      },
      ".cm-line": {
        padding: "0",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--fg)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "var(--selection-bg) !important",
      },
      ".cm-content ::selection": {
        backgroundColor: "var(--selection-bg) !important",
        color: "var(--selection-fg) !important",
      },
      ".cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--fg) 3.5%, transparent)",
      },
      ".cm-placeholder": {
        color: "var(--fg-muted)",
        opacity: "0.72",
      },
    },
    { dark: true },
  );
}

export interface NotesCodeEditorOptions {
  placeholder?: string;
  onDocChange?: (value: string) => void;
  onSelectionChange?: () => void;
  onFocusChange?: (focused: boolean) => void;
  onScroll?: () => void;
  readOnly?: boolean;
}

export function createNotesCodeEditorExtensions(options: NotesCodeEditorOptions): Extension[] {
  const extensions: Extension[] = [
    history(),
    drawSelection(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    Prec.high(markdownListKeymap),
    markdownStylePlugin,
    createNotesCodeEditorTheme(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        options.onDocChange?.(update.state.doc.toString());
      }
      if (update.selectionSet) {
        options.onSelectionChange?.();
      }
      if (update.focusChanged) {
        options.onFocusChange?.(update.view.hasFocus);
      }
      if (update.scrollChanged) {
        options.onScroll?.();
      }
    }),
  ];

  if (options.placeholder) {
    extensions.push(placeholder(options.placeholder));
  }

  if (options.readOnly) {
    extensions.push(EditorView.editable.of(false));
  }

  extensions.push(EditorView.contentAttributes.of({ spellcheck: "true" }));

  return extensions;
}

export function getNotesEditorCaretCoordinates(
  view: EditorView,
  position: number,
): { top: number; left: number; lineHeight: number } | null {
  const wrap = view.dom.closest(".notes-surface__editor-wrap") as HTMLElement | null;
  const coords = view.coordsAtPos(Math.max(0, Math.min(position, view.state.doc.length)));
  if (!wrap || !coords) return null;
  const wrapRect = wrap.getBoundingClientRect();
  const line = view.state.doc.lineAt(position);
  const lineStartCoords = view.coordsAtPos(line.from);
  const lineEndCoords = view.coordsAtPos(line.to);
  const lineHeight =
    lineStartCoords && lineEndCoords ? lineEndCoords.bottom - lineStartCoords.top : coords.bottom - coords.top;
  return {
    top: coords.top - wrapRect.top,
    left: coords.left - wrapRect.left,
    lineHeight: lineHeight || 20,
  };
}

export function measureNotesEditorLineWidth(view: EditorView, line: string): number {
  const style = window.getComputedStyle(view.contentDOM);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = [
    style.fontStyle,
    style.fontVariant,
    style.fontWeight,
    style.fontStretch,
    style.fontSize,
    style.fontFamily,
  ]
    .filter(Boolean)
    .join(" ");
  return ctx.measureText(line || " ").width;
}

export function getNotesEditorContentWidth(view: EditorView): number {
  const content = view.contentDOM;
  const style = window.getComputedStyle(content);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const fromContent = content.clientWidth - paddingLeft - paddingRight;
  if (fromContent > 0) return fromContent;

  const wrap = view.dom.closest(".notes-surface__editor-wrap");
  if (!wrap) return 0;
  const wrapStyle = getComputedStyle(wrap);
  const contentWidthVar = wrapStyle.getPropertyValue("--notes-editor-content-width").trim();
  if (contentWidthVar.endsWith("px")) {
    const parsed = Number.parseFloat(contentWidthVar);
    if (parsed > 0) return parsed;
  }
  return Math.max(0, wrap.clientWidth - paddingLeft - paddingRight);
}
