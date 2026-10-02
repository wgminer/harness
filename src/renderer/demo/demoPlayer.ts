/**
 * Demo player (`/demo-player.html`): pick a scene, watch it in a window-sized
 * frame, restart or loop it. Edits to scenes hot-reload the frame.
 */
import { DEMO_SCENES } from "./scenes";
import "./demoPlayer.css";

const params = new URLSearchParams(window.location.search);
let current = params.get("scene") ?? DEMO_SCENES.find((s) => s.kind === "clip")!.id;
let loop = params.get("loop") !== "0";

document.body.innerHTML = `
  <aside class="player__scenes">
    <h1>Scenes</h1>
    <nav></nav>
  </aside>
  <main class="player__stage">
    <div class="player__bar">
      <span class="player__name"></span>
      <span class="player__status"></span>
      <label class="player__loop"><input type="checkbox" /> Loop</label>
      <button type="button" class="player__restart">Restart</button>
    </div>
    <div class="player__fit"><iframe title="Demo frame"></iframe></div>
  </main>
`;

const nav = document.querySelector("nav")!;
const frame = document.querySelector("iframe")!;
const fit = document.querySelector<HTMLElement>(".player__fit")!;
const nameEl = document.querySelector<HTMLElement>(".player__name")!;
const statusEl = document.querySelector<HTMLElement>(".player__status")!;
const loopBox = document.querySelector<HTMLInputElement>(".player__loop input")!;
loopBox.checked = loop;

for (const kind of ["clip", "still"] as const) {
  const heading = document.createElement("h2");
  heading.textContent = kind === "clip" ? "Clips" : "Stills";
  nav.appendChild(heading);
  for (const scene of DEMO_SCENES.filter((s) => s.kind === kind)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = scene.id;
    button.dataset.scene = scene.id;
    button.addEventListener("click", () => {
      current = scene.id;
      load();
    });
    nav.appendChild(button);
  }
}

function scale() {
  const scene = DEMO_SCENES.find((s) => s.id === current)!;
  const { width, height } = scene.viewport;
  const box = fit.getBoundingClientRect();
  const s = Math.min(1, box.width / width, box.height / height);
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.transform = `scale(${s})`;
}

function load() {
  const scene = DEMO_SCENES.find((s) => s.id === current)!;
  for (const b of nav.querySelectorAll<HTMLButtonElement>("button")) {
    b.setAttribute("aria-current", String(b.dataset.scene === current));
  }
  nameEl.textContent = `${scene.id} · ${scene.viewport.width}×${scene.viewport.height}`;
  statusEl.textContent = "Playing";
  const url = new URL(window.location.href);
  url.searchParams.set("scene", current);
  history.replaceState(null, "", url);
  frame.src = `./demo.html?scene=${encodeURIComponent(current)}&t=${Date.now()}`;
  scale();
}

window.addEventListener("message", (event) => {
  if (event.data?.type !== "demo:done" || event.data.scene !== current) return;
  const error = frame.contentWindow?.__demo?.error;
  statusEl.textContent = error ? `Error: ${error}` : "Done";
  if (loop && !error) setTimeout(load, 1200);
});

loopBox.addEventListener("change", () => {
  loop = loopBox.checked;
});
document.querySelector(".player__restart")!.addEventListener("click", load);
window.addEventListener("resize", scale);
load();
