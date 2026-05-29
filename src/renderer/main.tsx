import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./base.css";
import "./modal.css";
import "./sidebar.css";
import "./chat.css";
import "./workspaceShell.css";
import "./settings.css";
import "./tasks.css";
import "./clippings.css";
import "./notes.css";
import "highlight.js/styles/github-dark.css";
import { GOOGLE_FONTS_HREF } from "../shared/theme";

/* Vite injects base.css before this runs; keep custom theme *after* all bundled CSS so :root overrides apply. */
const googleFonts = document.createElement("link");
googleFonts.rel = "stylesheet";
googleFonts.href = GOOGLE_FONTS_HREF;
document.head.appendChild(googleFonts);
const customThemeEl = document.getElementById("custom-theme");
if (customThemeEl) document.head.appendChild(customThemeEl);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
