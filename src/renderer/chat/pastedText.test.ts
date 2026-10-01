import { describe, expect, it } from "vitest";
import {
  PASTE_ATTACH_MIN_CHARS,
  PASTE_ATTACH_MIN_LINES,
  composeMessageWithPastes,
  pastedTextSizeLabel,
  shouldAttachPaste,
  splitPastedSegments,
} from "./pastedText";

describe("pastedText", () => {
  it("attaches pastes over the char or line threshold", () => {
    expect(shouldAttachPaste("short")).toBe(false);
    expect(shouldAttachPaste("x".repeat(PASTE_ATTACH_MIN_CHARS))).toBe(true);
    expect(shouldAttachPaste(Array(PASTE_ATTACH_MIN_LINES).fill("a").join("\n"))).toBe(true);
    expect(shouldAttachPaste(Array(PASTE_ATTACH_MIN_LINES - 1).fill("a").join("\n"))).toBe(false);
  });

  it("round-trips typed text and pasted blocks", () => {
    const blocks = [
      { id: "a", text: "line 1\nline 2\n" },
      { id: "b", text: "second <b>paste</b>" },
    ];
    const content = composeMessageWithPastes("  Summarize these  ", blocks);
    expect(splitPastedSegments(content)).toEqual([
      { kind: "text", text: "Summarize these" },
      { kind: "pasted", text: "line 1\nline 2" },
      { kind: "pasted", text: "second <b>paste</b>" },
    ]);
  });

  it("handles a paste with no typed text", () => {
    const content = composeMessageWithPastes("", [{ id: "a", text: "only" }]);
    expect(splitPastedSegments(content)).toEqual([{ kind: "pasted", text: "only" }]);
  });

  it("keeps attached file names", () => {
    const content = composeMessageWithPastes("Review", [{ id: "a", text: "x = 1", name: 'a "b".py' }]);
    expect(splitPastedSegments(content)).toEqual([
      { kind: "text", text: "Review" },
      { kind: "pasted", text: "x = 1", name: "a 'b'.py" },
    ]);
  });

  it("leaves ordinary messages alone", () => {
    expect(splitPastedSegments("hello")).toEqual([{ kind: "text", text: "hello" }]);
  });

  it("labels size by lines, then chars", () => {
    expect(pastedTextSizeLabel("a\nb\nc\n")).toBe("3 lines");
    expect(pastedTextSizeLabel("x".repeat(2500))).toBe("2.5k chars");
  });
});
