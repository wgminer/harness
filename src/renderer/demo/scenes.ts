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

const GRILL_FIRST = [
  "Before weighing anything: what would make staying feel like the right call a year from now?",
  "",
  "::::options",
  ':::option{title="I learned more than I would have there"}',
  ":::",
  ':::option{title="The team I have now is the one I want"}',
  ":::",
  ':::option{title="I had more time for my own work"}',
  ":::",
  "::::",
].join("\n");

const GRILL_SECOND = [
  "Then the question is less about the offer and more about your team. Have you told your manager you're looking?",
  "",
  "::::options",
  ':::option{title="Yes, and they know why"}',
  ":::",
  ':::option{title="No, not yet"}',
  ":::",
  ':::option{title="They suspect"}',
  ":::",
  "::::",
].join("\n");

export const DEMO_SCENES: DemoScene[] = [
  {
    id: "library",
    kind: "still",
    viewport: WIDE,
    session: { view: "chat", conversationId: "conv_demo_harness" },
    run: openLibrary,
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
  {
    id: "dictation",
    kind: "clip",
    viewport: WINDOW,
    session: composeHome,
    run: async (d) => {
      d.title("Phone app decisions");
      d.reply({ text: PHONE_REPLY, thinkMs: 2400 });
      await d.wait(1600);
      await d.dictate("What did I decide about the phone app last week, and what's still open?", {
        speakMs: 3800,
      });
      await d.wait(streamMs(PHONE_REPLY, 2400) + 2200);
    },
  },
  {
    id: "grill",
    kind: "clip",
    viewport: WINDOW,
    session: composeHome,
    run: async (d) => {
      d.title("Take the offer or stay");
      d.reply({ text: GRILL_FIRST, thinkMs: 1800 });
      d.reply({ text: GRILL_SECOND, thinkMs: 1600 });
      d.showCursor({ x: 820, y: 640 });
      await d.wait(700);
      await d.click('[data-testid="chat-mode-qa"]');
      await d.click("textarea");
      await d.type("I have an offer from another team. Should I take it or stay?");
      await d.wait(300);
      await d.click({ label: "Send message" });
      await d.moveTo({ x: 860, y: 420 }, { durationMs: 900 });
      await d.waitFor('[data-testid="qa-choice-1"]', 15000);
      await d.wait(900);
      await d.click('[data-testid="qa-choice-1"]');
      await d.moveTo({ x: 880, y: 300 }, { durationMs: 900 });
      await d.wait(streamMs(GRILL_SECOND) + 2000);
    },
  },
];

export function findScene(id: string | null): DemoScene {
  return DEMO_SCENES.find((s) => s.id === id) ?? DEMO_SCENES.find((s) => s.kind === "clip")!;
}
