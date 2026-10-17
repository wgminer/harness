import type { UiSession } from "../../shared/uiSession";
import type { DemoDesktopConfig, DemoMailThread } from "./demoDesktop";
import type { DemoRuntime } from "./demoRuntime";

export type DemoScene = {
  id: string;
  /** Stills export one PNG when `run` finishes; clips export video of the whole run. */
  kind: "still" | "clip";
  viewport: { width: number; height: number };
  /** Frame the app as a background window on a desktop, with a mail inbox in front. */
  desktop?: DemoDesktopConfig;
  session: Partial<UiSession>;
  run: (d: DemoRuntime) => Promise<void>;
};

const WIDE = { width: 1440, height: 900 };
/** A small desktop, so the windows on it stay legible at the site's hero width. */
const DESKTOP = { width: 1200, height: 750 };
/** Whole windows at laptop-ish 4:3, so text wraps the way it does on a real screen. */
const WINDOW = { width: 1040, height: 780 };

const composeHome: Partial<UiSession> = { view: "chat", conversationId: null };

const openLibrary = (d: DemoRuntime) => d.click({ label: "Show sidebar" }, { instant: true });

/** The inbox the hero works down, each with the reply said out loud and its title in the library. */
const INBOX: Array<DemoMailThread & { reply: string; title: string; speakMs: number }> = [
  {
    from: "Sam Okafor",
    subject: "Thursday",
    body: "Are you free Thursday to go over the draft? Afternoon works best for me.",
    reply: "Thursday works. Any time after two, and I'll bring the draft.",
    title: "Thursday with Sam",
    speakMs: 1900,
  },
  {
    from: "Priya Nair",
    subject: "Invoice 1042",
    body: "Did the September invoice go out? Finance is asking.",
    reply: "It went out Monday. I'll forward you the confirmation.",
    title: "September invoice",
    speakMs: 1800,
  },
  {
    from: "Dana Whitfield",
    subject: "Launch date",
    body: "Can we pull the launch in to the 21st? Marketing would love the extra week.",
    // Runs on the way speech does, so there is something to tidy afterward.
    reply:
      "No, the 21st is too early, we still have the sync bug open and I don't want to ship with that, the 28th is the earliest I'd be comfortable with.",
    title: "Launch date pushback",
    speakMs: 3000,
  },
];

const LAUNCH_PROOFREAD = [
  "The 21st is too early. The sync bug is still open, and I don't want to ship with it.",
  "",
  "The 28th is the earliest I'd be comfortable with.",
].join("\n");

export const DEMO_SCENES: DemoScene[] = [
  {
    // The site's top image: working down an inbox by voice, each reply pasted at the caret,
    // then over to Harness to tidy the last one with its suggested prompt.
    id: "hero",
    kind: "clip",
    viewport: DESKTOP,
    desktop: { mail: INBOX },
    session: composeHome,
    run: async (d) => {
      d.suggest("Proofread");
      d.reply({ text: LAUNCH_PROOFREAD, thinkMs: 1300 });
      await openLibrary(d);
      d.showCursor({ x: 1010, y: 560 });
      await d.wait(900);
      for (const [i, thread] of INBOX.entries()) {
        await d.dictateElsewhere(thread.reply, { speakMs: thread.speakMs, transcribeMs: 650, title: thread.title });
        if (i === INBOX.length - 1) break;
        await d.wait(500);
        await d.click(".demo-mail__send");
        await d.wait(350);
      }
      await d.wait(1500);
      await d.activate("harness", { x: 380, y: 72 });
      await d.wait(500);
      await d.click('[data-testid="dictation-suggested-prompt"]');
      await d.wait(4400);
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
