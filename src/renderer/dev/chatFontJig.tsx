import { useEffect, useState } from "react";
import "./chatFontJig.css";

/**
 * Jig for trying assistant-prose typefaces in the chat thread. Each direction overrides the
 * `--font-*-chat` tokens from base.css (plus a few jig-only knobs read by chatFontJig.css); "Current"
 * clears every override. Webfont directions load from Google Fonts on first use, so they need a network.
 */

/** Flip to false (or remove the mount in RootApp) before shipping; the jig is for font iteration only. */
export const CHAT_FONT_JIG_ENABLED = false;

const STORAGE_KEY = "harness.chat-font-jig.v1";
const GOOGLE_FONTS = "https://fonts.googleapis.com/css2?display=swap&family=";

type Direction = {
  id: string;
  label: string;
  /** One line on the voice this direction is going for. */
  note: string;
  /** Google Fonts `family=` value; omitted for system and bundled faces. */
  webfont?: string;
  vars: Record<string, string>;
};

const DIRECTIONS: Direction[] = [
  { id: "current", label: "Current", note: "VT323, phosphor CRT", vars: {} },
  {
    id: "newsreader",
    label: "Newsreader",
    note: "Newsreader, light, the previous default",
    vars: {
      "--font-family-chat": '"Newsreader Variable", var(--font-family-serif)',
      "--font-size-chat": "16px",
      "--font-weight-chat": "350",
      "--font-weight-chat-strong": "500",
    },
  },
  {
    id: "fraunces",
    label: "Soft wonk",
    note: "Fraunces, soft and wonky old-style",
    webfont: "Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,100..900,0..100,0..1;1,9..144,100..900,0..100,0..1",
    vars: {
      "--font-family-chat": '"Fraunces", var(--font-family-serif)',
      "--font-weight-chat": "340",
      "--font-weight-chat-strong": "600",
      "--jig-chat-variations": '"SOFT" 100, "WONK" 1',
    },
  },
  {
    id: "didone",
    label: "Didone",
    note: "Bodoni Moda, high contrast, fashion-plate",
    webfont: "Bodoni+Moda:ital,opsz,wght@0,6..96,400..900;1,6..96,400..900",
    vars: {
      "--font-family-chat": '"Bodoni Moda", Didot, var(--font-family-serif)',
      "--font-size-chat": "17px",
      "--line-height-chat": "26px",
      "--font-weight-chat": "400",
      "--font-weight-chat-strong": "700",
    },
  },
  {
    id: "whisper",
    label: "Whisper",
    note: "Cormorant italic as the body, roman for emphasis",
    webfont: "Cormorant+Garamond:ital,wght@0,300..700;1,300..700",
    vars: {
      "--font-family-chat": '"Cormorant Garamond", var(--font-family-serif)',
      "--font-size-chat": "20px",
      "--line-height-chat": "26px",
      "--font-weight-chat": "400",
      "--font-weight-chat-strong": "700",
      "--jig-chat-style": "italic",
      "--jig-chat-em-style": "normal",
    },
  },
  {
    id: "inscription",
    label: "Inscription",
    note: "Optima, flared and carved",
    vars: {
      "--font-family-chat": 'Optima, "Gill Sans", var(--font-family)',
      "--font-size-chat": "17px",
      "--font-weight-chat": "400",
      "--font-weight-chat-strong": "700",
      "--jig-chat-tracking": "0.01em",
    },
  },
  {
    id: "grotesque",
    label: "Odd grotesk",
    note: "Bricolage Grotesque, narrow with quirks",
    webfont: "Bricolage+Grotesque:opsz,wght@12..96,200..800",
    vars: {
      "--font-family-chat": '"Bricolage Grotesque", var(--font-family)',
      "--font-weight-chat": "320",
      "--font-weight-chat-strong": "600",
    },
  },
  {
    id: "rounded",
    label: "Rounded",
    note: "SF Rounded, friendly appliance",
    vars: {
      "--font-family-chat": 'ui-rounded, "SF Pro Rounded", var(--font-family)',
      "--font-weight-chat": "400",
      "--font-weight-chat-strong": "600",
    },
  },
  {
    id: "typewriter",
    label: "Typewriter",
    note: "American Typewriter, a letter from the machine",
    vars: {
      "--font-family-chat": '"American Typewriter", Courier, var(--font-family-mono)',
      "--font-size-chat": "15px",
      "--font-weight-chat": "300",
      "--font-weight-chat-strong": "600",
    },
  },
  {
    id: "terminal",
    label: "Terminal",
    note: "IBM Plex Mono, light, the agent as a process",
    webfont: "IBM+Plex+Mono:ital,wght@0,300;0,500;1,300;1,500",
    vars: {
      "--font-family-chat": '"IBM Plex Mono", var(--font-family-mono)',
      "--font-size-chat": "14px",
      "--font-weight-chat": "300",
      "--font-weight-chat-strong": "500",
    },
  },
  {
    id: "hand",
    label: "Hand",
    note: "Caveat, notes in the margin",
    webfont: "Caveat:wght@400..700",
    vars: {
      "--font-family-chat": '"Caveat", "Bradley Hand", cursive',
      "--font-size-chat": "22px",
      "--line-height-chat": "26px",
      "--font-weight-chat": "400",
      "--font-weight-chat-strong": "700",
    },
  },
  {
    id: "gothic",
    label: "Gothic",
    note: "Grenze Gotisch, blackletter you can still read",
    webfont: "Grenze+Gotisch:wght@100..900",
    vars: {
      "--font-family-chat": '"Grenze Gotisch", var(--font-family-serif)',
      "--font-size-chat": "19px",
      "--line-height-chat": "26px",
      "--font-weight-chat": "350",
      "--font-weight-chat-strong": "700",
    },
  },
];

const ALL_VARS = [...new Set(DIRECTIONS.flatMap((d) => Object.keys(d.vars)))];

function readStoredId(): string {
  try {
    const id = window.localStorage.getItem(STORAGE_KEY);
    return DIRECTIONS.some((d) => d.id === id) ? (id as string) : "current";
  } catch {
    return "current";
  }
}

function ensureWebfont(direction: Direction): void {
  if (!direction.webfont) return;
  const linkId = `chat-font-jig-${direction.id}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  link.href = GOOGLE_FONTS + direction.webfont;
  document.head.appendChild(link);
}

function applyDirection(direction: Direction): void {
  const root = document.documentElement;
  for (const name of ALL_VARS) root.style.removeProperty(name);
  if (direction.id === "current") {
    delete root.dataset.chatFontJig;
    return;
  }
  ensureWebfont(direction);
  for (const [name, value] of Object.entries(direction.vars)) root.style.setProperty(name, value);
  root.dataset.chatFontJig = direction.id;
}

export function ChatFontJig() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(readStoredId);
  const active = DIRECTIONS.find((d) => d.id === activeId) ?? DIRECTIONS[0];

  useEffect(() => {
    applyDirection(active);
    try {
      window.localStorage.setItem(STORAGE_KEY, active.id);
    } catch {
      // Ignore quota / private-mode failures.
    }
  }, [active]);

  return (
    <div className="chat-font-jig">
      {open ? (
        <ul className="chat-font-jig__list" role="listbox" aria-label="Chat font direction">
          {DIRECTIONS.map((direction) => (
            <li key={direction.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={direction.id === active.id}
                className="chat-font-jig__option"
                title={direction.note}
                onClick={() => setActiveId(direction.id)}
              >
                {direction.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="chat-font-jig__tag"
        aria-expanded={open}
        title={active.note}
        onClick={() => setOpen((value) => !value)}
      >
        Aa {active.label}
      </button>
    </div>
  );
}
