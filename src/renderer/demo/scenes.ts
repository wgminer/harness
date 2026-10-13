import type { UiSession } from "../../shared/uiSession";
import type { DemoRuntime } from "./demoRuntime";

export type DemoScene = {
  id: string;
  /** Stills export one PNG when `run` finishes; clips export video of the whole run. */
  kind: "still" | "clip";
  viewport: { width: number; height: number };
  session: Partial<UiSession>;
  run: (d: DemoRuntime) => Promise<void>;
};

const WIDE = { width: 1440, height: 900 };
/** Whole windows at laptop-ish 4:3, so text wraps the way it does on a real screen. */
const WINDOW = { width: 1040, height: 780 };

const composeHome: Partial<UiSession> = { view: "chat", conversationId: null };

/** Rough on-screen time for a scripted reply; keep in step with demoAdapter's defaults. */
function streamMs(text: string, thinkMs = 1600): number {
  return thinkMs + Math.ceil(text.length / 3) * 24;
}

const openLibrary = (d: DemoRuntime) => d.click({ label: "Show sidebar" }, { instant: true });

const PHONE_REPLY = [
  "From your note *Week of September 14*:",
  "",
  "- Dictation stays the default on the phone; typing is the fallback.",
  "- A widget that starts dictation in one tap is on the ideas list.",
  "",
  "Still open: whether memory needs an expiry, and where long replies should land when no note is open.",
].join("\n");

const PHONE_QUESTION = "What did I decide about the phone app last week, and what's still open?";

export const DEMO_SCENES: DemoScene[] = [
  {
    // The site's top image: Fn from anywhere, a spoken question, an answer from a note, then the library.
    id: "hero",
    kind: "clip",
    viewport: WIDE,
    session: composeHome,
    run: async (d) => {
      d.title("Phone app decisions");
      d.reply({ text: PHONE_REPLY, thinkMs: 2000 });
      await d.wait(1200);
      await d.dictate(PHONE_QUESTION, { speakMs: 4200 });
      await d.wait(streamMs(PHONE_REPLY, 2000) + 1400);
      d.showCursor({ x: 420, y: 520 });
      await d.wait(300);
      await d.click({ label: "Show sidebar" });
      await d.moveTo({ x: 560, y: 600 }, { durationMs: 800 });
      await d.wait(2600);
    },
  },
  {
    id: "library",
    kind: "still",
    viewport: WIDE,
    session: { view: "chat", conversationId: "conv_demo_harness" },
    run: openLibrary,
  },
  {
    id: "dictation",
    kind: "still",
    viewport: WINDOW,
    session: composeHome,
    run: async (d) => {
      await d.listen({ speakMs: 2600 });
    },
  },
  {
    id: "grill",
    kind: "still",
    viewport: WINDOW,
    session: { view: "chat", conversationId: "conv_demo_qa" },
    run: async (d) => {
      await d.waitFor('[data-testid="qa-choice-1"]');
    },
  },
  {
    id: "notes",
    kind: "still",
    viewport: WINDOW,
    session: { view: "notes", notesOpenNoteId: "note_demo_week" },
    run: openLibrary,
  },
  {
    id: "tasks",
    kind: "still",
    viewport: WINDOW,
    session: { view: "tasks" },
    run: async (d) => {
      await d.waitFor({ text: "Call the dentist about Thursday" });
    },
  },
];

export function findScene(id: string | null): DemoScene {
  return DEMO_SCENES.find((s) => s.id === id) ?? DEMO_SCENES.find((s) => s.kind === "clip")!;
}
