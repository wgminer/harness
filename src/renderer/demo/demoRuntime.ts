import type { DemoBackend, DemoReply } from "./demoAdapter";

/** A CSS selector, an accessible name, or visible text (optionally inside a selector). */
export type DemoTarget = string | { label: string } | { text: string; within?: string };

export type DemoPoint = { x: number; y: number };

export type DemoRuntime = {
  wait: (ms: number) => Promise<void>;
  /** Wait until `target` exists (scene setup, not shown as time on screen in stills). */
  waitFor: (target: DemoTarget, timeoutMs?: number) => Promise<Element>;
  moveTo: (target: DemoTarget | DemoPoint, options?: { durationMs?: number }) => Promise<void>;
  click: (target: DemoTarget, options?: { durationMs?: number; instant?: boolean }) => Promise<void>;
  type: (text: string, options?: { charsPerSecond?: number }) => Promise<void>;
  /** Fn dictation from another app: the full-screen field, then transcription, then the composer. */
  dictate: (text: string, options?: { speakMs?: number; transcribeMs?: number }) => Promise<void>;
  reply: (reply: DemoReply | string) => void;
  title: (title: string) => void;
  showCursor: (at: DemoPoint) => void;
  hideCursor: () => void;
};

const CURSOR_SVG = `<svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 3.5v18.2l4.6-4.4 3.1 6.9 3.2-1.4-3.1-6.8h6.4z" fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;
/** Arrow tip inside the SVG. */
const HOTSPOT = { x: 6, y: 3.5 };

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `frame(progress)` on animation frames for `durationMs` of page time. */
function animate(durationMs: number, frame: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      frame(t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

function resolveTarget(target: DemoTarget): Element | null {
  if (typeof target === "string") return document.querySelector(target);
  if ("label" in target) return document.querySelector(`[aria-label="${CSS.escape(target.label)}"]`);
  const scope = target.within ? document.querySelector(target.within) : document.body;
  if (!scope) return null;
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
  let match: Element | null = null;
  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    if (el.textContent?.trim() === target.text) match = el; // deepest match wins
  }
  return match?.closest("button, a, [role=button], [role=menuitem], [role=option], li") ?? match;
}

function isPoint(target: DemoTarget | DemoPoint): target is DemoPoint {
  return typeof target === "object" && "x" in target;
}

function describe(target: DemoTarget): string {
  return typeof target === "string" ? target : JSON.stringify(target);
}

function centerOf(el: Element): DemoPoint {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Speech-like mic levels: syllable bursts grouped into words, with short gaps. */
function speechLevels(durationMs: number, random: () => number): (ms: number) => number {
  const bursts: Array<{ start: number; end: number; peak: number }> = [];
  let t = 120;
  while (t < durationMs - 200) {
    const syllables = 1 + Math.floor(random() * 3);
    for (let i = 0; i < syllables && t < durationMs - 200; i++) {
      const len = 110 + random() * 120;
      bursts.push({ start: t, end: t + len, peak: 0.035 + random() * 0.06 });
      t += len + 20 + random() * 40;
    }
    t += 90 + random() * 180;
  }
  return (ms) => {
    let level = 0.004 + random() * 0.004;
    for (const b of bursts) {
      if (ms < b.start || ms > b.end) continue;
      const phase = (ms - b.start) / (b.end - b.start);
      level = Math.max(level, b.peak * Math.sin(Math.PI * phase) * (0.8 + random() * 0.4));
    }
    return level;
  };
}

export function createDemoRuntime(backend: DemoBackend): DemoRuntime & { cursor: () => DemoPoint | null } {
  let cursorEl: HTMLDivElement | null = null;
  let pos: DemoPoint | null = null;

  const place = (p: DemoPoint, scale = 1) => {
    pos = p;
    if (!cursorEl) return;
    cursorEl.style.transform = `translate(${p.x - HOTSPOT.x}px, ${p.y - HOTSPOT.y}px) scale(${scale})`;
  };

  const showCursor = (at: DemoPoint) => {
    if (!cursorEl) {
      cursorEl = document.createElement("div");
      cursorEl.className = "demo-cursor";
      cursorEl.innerHTML = CURSOR_SVG;
      cursorEl.style.transformOrigin = `${HOTSPOT.x}px ${HOTSPOT.y}px`;
      document.body.appendChild(cursorEl);
    }
    place(at);
  };

  const hideCursor = () => {
    cursorEl?.remove();
    cursorEl = null;
    pos = null;
  };

  const waitFor = async (target: DemoTarget, timeoutMs = 8000) => {
    const start = performance.now();
    for (;;) {
      const el = resolveTarget(target);
      if (el) return el;
      if (performance.now() - start > timeoutMs) throw new Error(`Demo target not found: ${describe(target)}`);
      await sleep(50);
    }
  };

  const moveTo: DemoRuntime["moveTo"] = async (target, options = {}) => {
    const to = isPoint(target) ? target : centerOf(await waitFor(target));
    const from = pos ?? to;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const durationMs = options.durationMs ?? Math.min(900, 280 + distance * 0.9);
    // Bow the path slightly, the way a hand moves a mouse.
    const bend = { x: -(to.y - from.y) * 0.12, y: (to.x - from.x) * 0.12 };
    await animate(durationMs, (raw) => {
      const t = easeInOut(raw);
      const arc = Math.sin(Math.PI * t);
      place({
        x: from.x + (to.x - from.x) * t + bend.x * arc,
        y: from.y + (to.y - from.y) * t + bend.y * arc,
      });
    });
  };

  const click: DemoRuntime["click"] = async (target, options = {}) => {
    const el = await waitFor(target);
    if (!options.instant) {
      await moveTo(target, options);
      await sleep(90);
      place(pos!, 0.86);
    }
    const at = options.instant || !pos ? centerOf(el) : pos;
    const init = { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 0 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mousedown", init));
    // Only text fields take focus: a programmatic focus() on a button shows a ring a mouse click would not.
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.focus();
    if (!options.instant) await sleep(80);
    el.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.dispatchEvent(new MouseEvent("click", init));
    if (!options.instant) {
      place(pos!, 1);
      await sleep(120);
    }
  };

  const type: DemoRuntime["type"] = async (text, options = {}) => {
    const el = document.activeElement;
    if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) {
      throw new Error("Demo type(): focus a text field first (click it).");
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setValue = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    const base = 1000 / (options.charsPerSecond ?? 22);
    for (const ch of text) {
      setValue.call(el, el.value + ch);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      // Uneven rhythm reads as typing; pause a beat after words and punctuation.
      const pause = ch === " " ? base * 1.6 : /[,.?!]/.test(ch) ? base * 4 : base * (0.6 + Math.random() * 0.8);
      await sleep(pause);
    }
  };

  const showKey = (label: string) => {
    const key = document.createElement("div");
    key.className = "demo-key";
    key.textContent = label;
    key.dataset.state = "hidden";
    document.body.appendChild(key);
    return key;
  };

  const dictate: DemoRuntime["dictate"] = async (text, options = {}) => {
    const speakMs = options.speakMs ?? 3200;
    const levelAt = speechLevels(speakMs, Math.random);
    const key = showKey("fn");
    await sleep(30);
    key.dataset.state = "up";
    await sleep(380);
    key.dataset.state = "down";
    await sleep(120);
    key.dataset.state = "up";
    backend.recording.started({ focused: false });
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const elapsed = performance.now() - start;
        backend.recording.level(levelAt(elapsed));
        if (elapsed < speakMs) setTimeout(tick, 33);
        else resolve();
      };
      tick();
    });
    backend.recording.level(0);
    key.dataset.state = "down";
    await sleep(120);
    key.dataset.state = "hidden";
    setTimeout(() => key.remove(), 400);
    backend.recording.stopped();
    backend.recording.transcribing({ recordingPath: null });
    await sleep(options.transcribeMs ?? 1100);
    backend.recording.transcriptReady(text);
  };

  return {
    wait: sleep,
    waitFor,
    moveTo,
    click,
    type,
    dictate,
    reply: (reply) => backend.queueReply(typeof reply === "string" ? { text: reply } : reply),
    title: (title) => backend.setTitle(title),
    showCursor,
    hideCursor,
    cursor: () => pos,
  };
}
