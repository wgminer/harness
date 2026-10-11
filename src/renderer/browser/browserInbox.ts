import type { HarnessAPI } from "../../shared/desktopAPI";
import type { InboxItem } from "../../shared/inbox";
import type { createBrowserStore } from "./browserStore";

const HOUR = 60 * 60 * 1000;

/** Sample captures so the Inbox surface can be worked on in the browser shell. Not persisted. */
function sampleItems(now: number): InboxItem[] {
  return [
    {
      id: "cap_sample_dictation",
      kind: "dictation",
      createdAt: now - HOUR,
      receivedAt: now - HOUR,
      source: "ios",
      text: "Remind me to ask the contractor about the back fence, and whether the quote covers hauling away the old panels.",
      attachments: [],
    },
    {
      id: "cap_sample_link",
      kind: "link",
      createdAt: now - 3 * HOUR,
      receivedAt: now - 3 * HOUR,
      source: "ios",
      text: "Worth reading before the planning call.",
      url: "https://example.com/article",
      title: "An example article",
      attachments: [],
    },
    {
      id: "cap_sample_text",
      kind: "text",
      createdAt: now - 26 * HOUR,
      receivedAt: now - 26 * HOUR,
      source: "ios",
      text: "Book idea: field notes format, one page per day.",
      attachments: [],
    },
  ];
}

export function createBrowserInbox(store: ReturnType<typeof createBrowserStore>): HarnessAPI["inbox"] {
  let items = sampleItems(Date.now());
  const patch = (id: string, next: Partial<InboxItem>) => {
    items = items.map((item) => (item.id === id ? { ...item, ...next } : item));
    return items;
  };

  return {
    list: async () => items,
    refresh: async () => items,
    updateText: async (id, text) => patch(id, { text }),
    process: async (id, action) => {
      const item = items.find((entry) => entry.id === id);
      let resultId: string | undefined;
      if (item && action === "task") {
        store.createTask(item.text.split("\n")[0] || item.url || "Captured item");
      } else if (item && action === "note") {
        resultId = store.createNote(undefined, item.text).id;
      }
      return {
        items: patch(id, { processedAt: Date.now(), processedAs: action, resultId }),
        resultId,
      };
    },
    restore: async (id) =>
      patch(id, { processedAt: undefined, processedAs: undefined, resultId: undefined }),
    clearProcessed: async () => {
      items = items.filter((item) => item.processedAt == null);
      return items;
    },
    onChanged: () => () => {},
  };
}
