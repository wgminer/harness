import { describe, expect, it } from "vitest";
import { DEFAULT_UI_SESSION, normalizeUiSession } from "./uiSession";

describe("normalizeUiSession", () => {
  it("returns defaults for invalid input", () => {
    expect(normalizeUiSession(null)).toEqual(DEFAULT_UI_SESSION);
    expect(normalizeUiSession("nope")).toEqual(DEFAULT_UI_SESSION);
  });

  it("keeps known views and trims ids", () => {
    expect(
      normalizeUiSession({
        view: "tasks",
        conversationId: "  abc  ",
        notesOpenNoteId: "note-1",
        setupNoticeDismissed: true,
      })
    ).toEqual({
      view: "tasks",
      conversationId: "abc",
      notesOpenNoteId: "note-1",
      imagesOpenImageId: null,
      setupNoticeDismissed: true,
      openNoteInStickyWindow: false,
    });
  });

  it("drops unknown views and empty ids", () => {
    expect(
      normalizeUiSession({
        view: "unknown",
        conversationId: "   ",
        notesOpenNoteId: 42,
      })
    ).toEqual({
      view: "chat",
      conversationId: null,
      notesOpenNoteId: null,
      imagesOpenImageId: null,
      setupNoticeDismissed: false,
      openNoteInStickyWindow: false,
    });
  });

  it("keeps images view and image id", () => {
    expect(
      normalizeUiSession({
        view: "images",
        imagesOpenImageId: " img-1 ",
      })
    ).toEqual({
      view: "images",
      conversationId: null,
      notesOpenNoteId: null,
      imagesOpenImageId: "img-1",
      setupNoticeDismissed: false,
      openNoteInStickyWindow: false,
    });
  });
});
