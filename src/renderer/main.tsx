import React from "react";
import ReactDOM from "react-dom/client";
import { applyAccent } from "../shared/accent";
import { applyAppearanceTheme } from "../shared/timeOfDayBackground";
import { normalizeAppearanceTheme, type Settings } from "../shared/types";
import { createBrowserAdapter } from "./browser/browserAdapter";
import { isTauriRuntime } from "./browser/isTauriRuntime";
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

const webClient = !isTauriRuntime();
window.harness = webClient ? createBrowserAdapter() : createHarnessAdapter();
if (webClient) {
  document.documentElement.dataset.harnessClient = "web";
}
void (async () => {
  try {
    const settings = (await window.harness.settings.get()) as Settings;
    setCachedSettings(settings);
    applyAccent(settings.appearance?.accent);
    applyAppearanceTheme(normalizeAppearanceTheme(settings.appearance?.theme));
  } catch {
    // Keep CSS default accent and dark chrome if settings fail to load.
  }
  const sticky = await isCurrentStickyWindow();
  if (!sticky) {
    initGlobalHotkeyController();
    void window.harness.recording.signalFrontendReady();
  }
  const web = await window.harness.env.isHarnessWeb();
  const dev = await window.harness.env.isHarnessDev();
  if (web && !sticky) document.title = "Harness Web";
  else if (dev && !sticky) document.title = "Harness Dev";
})();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootApp />
  </React.StrictMode>
);
