#!/usr/bin/env node
/** Map legacy color tokens → consolidated palette. */
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const RENDERER = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "renderer");

const MAP = {
  "--overlay-faint": "--overlay-subtle",
  "--overlay-weak": "--overlay-subtle",
  "--overlay-medium": "--overlay-subtle",
  "--list-row-hover-bg": "--overlay-subtle",
  "--overlay-stronger": "--overlay",
  "--surface-highlight": "--overlay",
  "--overlay-heavy": "--overlay-strong",
  "--overlay-max": "--overlay-strong",
  "--overlay-focus": "--overlay-strong",
  "--callout-note-edge": "--overlay-strong",
  "--slide-quote-mark": "--overlay-strong",
  "--slide-dot": "--overlay-subtle",
  "--fg-muted-soft": "--fg-muted",
  "--fg-muted-overlay": "--fg-muted",
  "--fg-muted-subtle": "--fg-muted",
  "--fg-muted-faded": "--fg-muted",
  "--fg-secondary": "--fg-muted",
  "--fg-secondary-soft": "--fg-muted",
  "--notes-fg-muted-btn": "--fg-muted",
  "--control-bg": "--hover-bg",
  "--btn-bg": "--hover-bg",
  "--btn-bg-sidebar": "--hover-bg",
  "--surface-hover": "--hover-bg",
  "--surface-raised": "--bg-elevated",
  "--control-bg-hover": "--hover-bg-strong",
  "--control-bg-strong": "--hover-bg-strong",
  "--surface-hover-strong": "--hover-bg-strong",
  "--settings-nav-hover": "--hover-bg",
  "--settings-preset-bg": "--hover-bg",
  "--link-card-hover-bg": "--hover-bg",
  "--settings-nav-active": "--accent-muted",
  "--settings-nav-active-strong": "--accent-muted",
  "--accent-soft": "--accent-muted",
  "--accent-soft-strong": "--accent-muted",
  "--accent-option-bg": "--accent-muted",
  "--accent-surface": "--accent-muted",
  "--accent-surface-strong": "--accent-muted",
  "--notes-accent-surface": "--accent-muted",
  "--notes-accent-surface-strong": "--accent-muted",
  "--notes-panel-bg": "--accent-muted",
  "--accent-overlay": "--accent-tint",
  "--accent-overlay-strong": "--accent-tint",
  "--accent-overlay-focus": "--accent-tint",
  "--accent-overlay-border": "--accent-tint",
  "--accent-badge-bg": "--accent-tint",
  "--grid-line-weak": "--accent-tint",
  "--grid-line-strong": "--accent-tint",
  "--accent-chip-border": "--accent",
  "--accent-option-border": "--accent",
  "--settings-accent-border": "--accent",
  "--chip-warn-border": "--warning",
  "--chip-danger-border": "--danger-fg",
  "--chip-success-border": "--success-fg",
  "--accent-callout-edge": "--accent-readable",
  "--accent-border-strong": "--accent",
  "--accent-border": "--accent",
  "--border-edge-dark": "--border-edge",
  "--hairline-glass": "--border-edge",
  "--settings-edge": "--border-edge",
  "--settings-tab-edge": "--border-edge",
  "--list-row-hover-border": "--border-edge",
  "--border-input-glass": "--border-input",
  "--sidebar-control-hover-bg": "--hover-bg",
  "--sidebar-control-active-hover-bg": "--accent-muted",
  "--accent-active": "--accent-muted",
  "--danger-soft": "--danger-muted",
  "--danger-soft-hover": "--danger-hover",
  "--settings-danger-soft": "--danger-muted",
  "--recording": "--danger-fg",
  "--recording-hover": "--danger-fg",
  "--recording-ring": "--danger-fg",
  "--recording-ring-hover": "--danger-fg",
  "--shadow-drop-medium": "--shadow-drop",
  "--shadow-drop-strong": "--shadow-drop",
  "--shadow-composer": "--shadow-drop",
  "--focus-ring-color": "--accent",
  "--focus-ring-subtle": "--overlay-strong",
  "--success-focus-ring": "--success-hover",
  "--notes-preview-bg": "--bg-elevated",
  "--settings-swatch-ring": "--hover-bg-strong",
  "--scrollbar-thumb-hover": "--scrollbar-thumb",
  "--border-dark": "--border-light",
};

function applyMap(content) {
  let out = content;
  for (const [from, to] of Object.entries(MAP)) {
    out = out.replaceAll(`var(${from})`, `var(${to})`);
  }
  return out;
}

for (const file of readdirSync(RENDERER)) {
  if (!file.endsWith(".css") && file !== "notesEditorExtensions.ts") continue;
  const path = join(RENDERER, file);
  writeFileSync(path, applyMap(readFileSync(path, "utf8")));
}

console.log("consolidated", Object.keys(MAP).length, "token aliases");
