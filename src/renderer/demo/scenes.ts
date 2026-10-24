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

/** The inbox in the hero. The first two get answered by voice; the third waits. */
const MAIL: DemoMailThread[] = [
  {
    from: "Sam Okafor",
    subject: "Thursday",
    body: "Are you free Thursday to go over the draft? Afternoon works best for me.",
  },
  {
    from: "Priya Nair",
    subject: "Invoice 1042",
    body: "Did the September invoice go out? Finance is asking.",
  },
  {
    from: "Dana Whitfield",
    subject: "Launch date",
    body: "Can we pull the launch in to the 21st? Marketing would love the extra week.",
  },
];

/**
 * Each reply said out loud, with its title in the library. The clips are silent, so takes
 * run far shorter than real speech would.
 */
const MAIL_REPLIES = [
  {
    reply: "Thursday works. Any time after two, and I'll bring the draft.",
    title: "Thursday with Sam",
    speakMs: 900,
  },
  {
    reply: "It went out Monday. I'll forward you the confirmation.",
    title: "September invoice",
    speakMs: 850,
  },
];

/** A longer ask for the coding agent, run on the way speech does, so there is something to break down. */
const AGENT_ASK = {
  reply:
    "The sync badge gets stuck on syncing after the phone reconnects, can you find where the reconnect handler sets it and clear it once the reconnect actually succeeds, and add a test for that case, and don't touch the R2 client while you're in there.",
  title: "Sync badge after reconnect",
  speakMs: 1600,
};

const AGENT_BREAKDOWN = [
  "- Find where the reconnect handler sets the sync badge.",
  "- Clear the badge once the reconnect succeeds.",
  "- Add a test for the reconnect case.",
  "- Leave the R2 client alone.",
].join("\n");

/** One long take with names the cleanup pass has to get right. */
const DICTATION_TAKE =
  "Notes for Thursday with Sam Okafor. Start with the sync bug, then the Tauri upgrade. Ask Priya Nair whether finance needs the September numbers before the 28th, and if there's time, look at the lock screen widget.";

const DICTATION_REPLY = [
  "Agenda for Thursday with Sam:",
  "",
  "1. The sync bug",
  "2. The Tauri upgrade",
  "3. Lock screen widget, if there's time",
  "",
  "Before then, ask Priya whether finance needs the September numbers before the 28th.",
].join("\n");

export const DEMO_SCENES: DemoScene[] = [
  {
    // The site's top image: two emails answered by voice, each reply pasted at the caret,
    // then a longer ask dictated into a coding agent, then over to Harness to break that one down.
    id: "hero",
    kind: "clip",
    viewport: DESKTOP,
    desktop: { mail: MAIL, terminal: { cwd: "~/projects/harness", branch: "main" } },
    session: composeHome,
    run: async (d) => {
      d.suggest("Breakdown");
      d.reply({ text: AGENT_BREAKDOWN, thinkMs: 1300 });
      await openLibrary(d);
      d.showCursor({ x: 960, y: 540 });
      await d.wait(900);
      for (const take of MAIL_REPLIES) {
        await d.dictateElsewhere(take.reply, { speakMs: take.speakMs, transcribeMs: 450, title: take.title });
        await d.wait(500);
        await d.click(".demo-mail__send");
        await d.wait(350);
      }
      // The strip of terminal showing under the inbox.
      await d.activate("terminal", { x: 820, y: 652 });
      await d.wait(500);
      await d.dictateElsewhere(AGENT_ASK.reply, {
        speakMs: AGENT_ASK.speakMs,
        transcribeMs: 550,
        title: AGENT_ASK.title,
      });
      await d.wait(1500);
      // Harness's titlebar, above the other two windows.
      await d.activate("harness", { x: 430, y: 78 });
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
    // One whole take: Fn, a long stretch of talking, Fn again, transcription, and the
    // cleaned-up text in the composer.
    id: "dictation",
    kind: "clip",
    viewport: WINDOW,
    session: composeHome,
    run: async (d) => {
      // A focused take sends itself, so give it an answer and the loop closes.
      d.reply({ text: DICTATION_REPLY, thinkMs: 900 });
      d.title("Thursday with Sam");
      await d.wait(600);
      await d.dictate(DICTATION_TAKE, { speakMs: 2800, transcribeMs: 800 });
      await d.wait(4200);
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
