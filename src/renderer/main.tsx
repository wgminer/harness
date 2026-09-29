import React from "react";
import ReactDOM from "react-dom/client";
import { applyAccent } from "../shared/accent";
import { applyAppearanceTheme } from "../shared/timeOfDayBackground";
import { normalizeAppearanceTheme, type Settings } from "../shared/types";
import { createBrowserAdapter } from "./browser/browserAdapter";
import { isTauriRuntime } from "./browser/isTauriRuntime";
import { createHarnessAdapter } from "./desktopAdapter";
import { initGlobalHotkeyController } from "./recording/globalHotkeyController";
import { RootApp } from "./RootApp";
import { setCachedSettings } from "./settings/settingsSessionCache";
import { isCurrentStickyWindow } from "./notes/stickyWindow";
import "./base.css";
import "./ui/modal.css";
import "./ui/menu.css";
import "./setup/setupNotice.css";
import "./sidebar/sidebar.css";
import "./chat/chat.css";
import "./workspaceShell.css";
import "./settings/settings.css";
import "./tasks/tasks.css";
import "./search/search.css";
import "./notes/notes.css";
import "./images/images.css";
import "./notes/stickyNote.css";
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
