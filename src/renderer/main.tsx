import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createHarnessAdapter } from "./desktopAdapter";
import { initGlobalHotkeyController } from "./globalHotkeyController";
import { primeOnUserGesture } from "./recordingBootstrap";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./base.css";
import "./modal.css";
import "./sidebar.css";
import "./chat.css";
import "./workspaceShell.css";
import "./settings.css";
import "./tasks.css";
import "./notes.css";
import "highlight.js/styles/github-dark.css";

window.harness = createHarnessAdapter();
initGlobalHotkeyController();
primeOnUserGesture();
void window.harness.recording.signalFrontendReady();

void window.harness.env.isHarnessDev().then((dev) => {
  if (dev) document.title = "Harness Dev";
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
