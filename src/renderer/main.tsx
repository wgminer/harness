import React from "react";
import ReactDOM from "react-dom/client";
import { applyAccent } from "../shared/accent";
import type { Settings } from "../shared/types";
import { createHarnessAdapter } from "./desktopAdapter";
import { initGlobalHotkeyController } from "./globalHotkeyController";
import { RootApp } from "./RootApp";
import { isCurrentStickyWindow } from "./stickyWindow";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./base.css";
import "./modal.css";
import "./setupNotice.css";
import "./sidebar.css";
import "./chat.css";
import "./workspaceShell.css";
import "./settings.css";
import "./tasks.css";
import "./notes.css";
import "./images.css";
import "./stickyNote.css";
import "highlight.js/styles/github-dark.css";

window.harness = createHarnessAdapter();
void (async () => {
  try {
    const settings = (await window.harness.settings.get()) as Settings;
    applyAccent(settings.appearance?.accent);
  } catch {
    // Keep CSS default accent if settings fail to load.
  }
  const sticky = await isCurrentStickyWindow();
  if (!sticky) {
    initGlobalHotkeyController();
    void window.harness.recording.signalFrontendReady();
  }
  const dev = await window.harness.env.isHarnessDev();
  if (dev && !sticky) document.title = "Harness Dev";
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
