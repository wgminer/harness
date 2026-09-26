import { describe, expect, it } from "vitest";
import {
  isAudioAttachFile,
  isAudioAttachPath,
  pickAudioAttachFile,
  pickAudioAttachPath,
} from "./audioAttach";

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

describe("pickAudioAttachPath", () => {
  it("picks the first audio path", () => {
    expect(
      pickAudioAttachPath(["/tmp/notes.txt", "/Users/me/Desktop/interview.m4a", "/tmp/x.mp3"]),
    ).toBe("/Users/me/Desktop/interview.m4a");
  });

  it("rejects non-audio paths", () => {
    expect(isAudioAttachPath("/tmp/photo.PNG")).toBe(false);
    expect(pickAudioAttachPath(["/tmp/a.txt", "/tmp/b.pdf"])).toBeNull();
  });
});
