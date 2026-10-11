import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPTURE_CONTRACT,
  captureKindLabel,
  inboxChatDraft,
  inboxPendingCount,
  type CaptureKind,
  type InboxItem,
} from "./inbox";

const root = join(__dirname, "../..");

function item(partial: Partial<InboxItem>): InboxItem {
  return { id: "cap_1", kind: "text", createdAt: 1, receivedAt: 2, text: "", attachments: [], ...partial };
}

describe("capture contract", () => {
  it("has a label for every kind", () => {
    for (const kind of CAPTURE_CONTRACT.kinds) {
      expect(captureKindLabel(kind as CaptureKind)).not.toBe("Capture");
    }
  });

  it("names every envelope field the Rust reader deserializes", () => {
    const rust = readFileSync(join(root, "src-tauri/src/inbox.rs"), "utf8");
    const struct = rust.match(/pub struct CaptureEnvelope \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const fields = [...struct.matchAll(/pub (\w+):/g)].map(([, name]) =>
      name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()),
    );
    expect(fields.sort()).toEqual([...CAPTURE_CONTRACT.envelopeFields].sort());
  });
});

describe("inbox helpers", () => {
  it("counts only unprocessed captures", () => {
    expect(inboxPendingCount([item({}), item({ id: "b", processedAt: 5, processedAs: "task" })])).toBe(1);
  });

  it("appends the link to a chat draft once", () => {
    expect(inboxChatDraft(item({ text: "Read this", url: "https://a.test" }))).toBe(
      "Read this\n\nhttps://a.test",
    );
    expect(inboxChatDraft(item({ text: "see https://a.test", url: "https://a.test" }))).toBe(
      "see https://a.test",
    );
    expect(inboxChatDraft(item({ url: "https://a.test" }))).toBe("https://a.test");
  });
});
