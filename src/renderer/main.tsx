import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { createHarnessAdapter } from "./desktopAdapter";
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

void window.harness.env.isHarnessDev().then((dev) => {
  if (dev) document.title = "Harness Dev";
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
