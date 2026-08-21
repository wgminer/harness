import React from "react";
import ReactDOM from "react-dom/client";
import { applyAccent } from "../shared/accent";
import type { Settings } from "../shared/types";
import { createHarnessAdapter } from "./desktopAdapter";
import { initGlobalHotkeyController } from "./globalHotkeyController";
import { RootApp } from "./RootApp";
import { setCachedSettings } from "./settings/settingsSessionCache";
import { isCurrentStickyWindow } from "./stickyWindow";
import "./base.css";
import "./modal.css";
import "./setupNotice.css";
import "./sidebar.css";
import "./chat.css";
import "./workspaceShell.css";
import "./settings.css";
import "./tasks.css";
import "./search.css";
import "./notes.css";
import "./images.css";
import "./stickyNote.css";
import "highlight.js/styles/github-dark.css";

window.harness = createHarnessAdapter();
void (async () => {
  // These three reads are independent: issue them together so boot costs one
  // IPC round-trip instead of three chained ones. Side effects stay ordered.
  const settingsPromise = window.harness.settings.get().then(
    (s) => s as Settings,
    // Keep CSS default accent if settings fail to load.
    () => null,
  );
  const stickyPromise = isCurrentStickyWindow();
  const devPromise = window.harness.env.isHarnessDev();

  const settings = await settingsPromise;
  if (settings) {
    setCachedSettings(settings);
    applyAccent(settings.appearance?.accent);
  }
  const sticky = await stickyPromise;
  if (!sticky) {
    initGlobalHotkeyController();
    void window.harness.recording.signalFrontendReady();
  }
  const dev = await devPromise;
  if (dev && !sticky) document.title = "Harness Dev";
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
