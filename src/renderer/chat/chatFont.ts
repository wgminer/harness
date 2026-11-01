import type { ChatFont } from "../../shared/types";

/** Point `--font-family-chat` at the chosen stack (sans is the base.css default). */
export function applyChatFont(font: ChatFont): void {
  if (font === "sans") delete document.documentElement.dataset.chatFont;
  else document.documentElement.dataset.chatFont = font;
}
