import { describe, expect, it } from "vitest";
import { isAudioAttachFile, pickAudioAttachFile } from "./audioAttach";

function file(name: string, type = ""): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("isAudioAttachFile", () => {
  it("accepts audio MIME types", () => {
    expect(isAudioAttachFile(file("clip.bin", "audio/mpeg"))).toBe(true);
  });

  it("accepts common extensions when MIME is empty", () => {
    expect(isAudioAttachFile(file("interview.m4a"))).toBe(true);
    expect(isAudioAttachFile(file("take.WAV"))).toBe(true);
    expect(isAudioAttachFile(file("voice.caf"))).toBe(true);
  });

  it("rejects non-audio files", () => {
    expect(isAudioAttachFile(file("notes.pdf", "application/pdf"))).toBe(false);
    expect(isAudioAttachFile(file("photo.png", "image/png"))).toBe(false);
  });
});

describe("pickAudioAttachFile", () => {
  it("returns the first audio file in a mixed list", () => {
    const picked = pickAudioAttachFile([
      file("notes.txt", "text/plain"),
      file("take.m4a"),
      file("other.mp3", "audio/mpeg"),
    ]);
    expect(picked?.name).toBe("take.m4a");
  });

  it("returns null when nothing is audio", () => {
    expect(pickAudioAttachFile([file("a.txt"), file("b.png", "image/png")])).toBeNull();
  });
});
