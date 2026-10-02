/**
 * Demo frame (`/demo.html?scene=<id>`): the real app on a scripted backend,
 * running one scene. Watch it in the player (`/demo-player.html`), or let
 * `npm run capture:site` drive it frame by frame with `&record`.
 */
import { bootApp } from "../bootApp";
import { createDemoAdapter } from "./demoAdapter";
import { createDemoRuntime, type DemoPoint } from "./demoRuntime";
import { seedDemoStore } from "./demoSeed";
import { DEMO_SCENES, findScene } from "./scenes";
import "./demo.css";

export type DemoControl = {
  /** Every scene, so the recorder can list them without importing TypeScript. */
  scenes: Array<{ id: string; kind: "still" | "clip"; viewport: { width: number; height: number } }>;
  scene: string;
  kind: "still" | "clip";
  ready: boolean;
  done: boolean;
  error: string | null;
  start: () => void;
  cursor: () => DemoPoint | null;
  /** Recorder: pin every CSS animation and transition to page time so frames step in sync with timers. */
  syncAnimations: () => void;
};

declare global {
  interface Window {
    __demo?: DemoControl;
  }
}

const params = new URLSearchParams(window.location.search);
const scene = findScene(params.get("scene"));
const recording = params.has("record");

seedDemoStore(scene.session);
const backend = createDemoAdapter();
bootApp(backend.harness, { web: true });
const runtime = createDemoRuntime(backend);

const animationStart = new WeakMap<Animation, number>();
let started = false;

const control: DemoControl = {
  scenes: DEMO_SCENES.map(({ id, kind, viewport }) => ({ id, kind, viewport })),
  scene: scene.id,
  kind: scene.kind,
  ready: false,
  done: false,
  error: null,
  start: () => {
    if (started) return;
    started = true;
    void scene
      .run(runtime)
      .catch((err: unknown) => {
        control.error = err instanceof Error ? err.message : String(err);
        console.error(err);
      })
      .finally(() => {
        control.done = true;
        window.parent?.postMessage({ type: "demo:done", scene: scene.id }, "*");
      });
  },
  cursor: runtime.cursor,
  syncAnimations: () => {
    const now = performance.now();
    for (const animation of document.getAnimations()) {
      if (!animationStart.has(animation)) animationStart.set(animation, now);
      animation.pause();
      animation.currentTime = now - animationStart.get(animation)!;
    }
  },
};
window.__demo = control;

void (async () => {
  await runtime.waitFor(".app", 20000);
  await document.fonts.ready;
  await runtime.wait(500);
  control.ready = true;
  if (!recording) control.start();
})();
