/**
 * A stand-in macOS desktop around the demo app: menu bar with the Harness tray
 * icon, the Harness window in the background, and a mail inbox in front.
 * Scenes use it to show Fn dictation pasting into whatever has focus.
 */
import "./demoDesktop.css";

export type DemoTrayState = "ready" | "recording" | "processing";

export type DemoApp = "mail" | "harness";

/** A message waiting for a reply in the stand-in inbox. */
export type DemoMailThread = { from: string; subject: string; body: string };

export type DemoDesktopConfig = { mail: DemoMailThread[] };

export type DemoDesktop = {
  tray: (state: DemoTrayState) => void;
  /** Bring an app's window to the front, as a click on it would. */
  activate: (app: DemoApp) => void;
  /** Insert `text` at the open reply's caret in one step, the way a paste lands. */
  paste: (text: string) => void;
};

/** The same images the real tray uses (see `tray_icon_file` in global_effects.rs). */
const TRAY_ICONS: Record<DemoTrayState, string> = {
  ready: new URL("../../../resources/icon-tray@2x.png", import.meta.url).href,
  recording: new URL("../../../resources/icon-tray-recording@2x.png", import.meta.url).href,
  processing: new URL("../../../resources/icon-tray-processing@2x.png", import.meta.url).href,
};

const MENUS: Record<DemoApp, { name: string; items: string[] }> = {
  mail: { name: "Mail", items: ["File", "Edit", "View", "Mailbox", "Message", "Window", "Help"] },
  harness: { name: "Harness", items: ["File", "Edit", "View", "Window", "Help"] },
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function menuBar(menus: HTMLElement, tray: HTMLElement): HTMLElement {
  const bar = el("div", "demo-menubar");
  const left = menus;
  const right = el("div", "demo-menubar__group");
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  right.append(tray, el("span", "demo-menubar__item", `${day}  ${time}`));
  bar.append(left, right);
  return bar;
}

/** Wrap `#root` in the desktop. Call before the app renders. */
export function mountDemoDesktop(config: DemoDesktopConfig): DemoDesktop {
  const root = document.getElementById("root")!;
  document.body.classList.add("demo-desktop");

  const trayIcon = el("img", "demo-tray__icon");
  trayIcon.alt = "";
  const trayTitle = el("span", "demo-tray__title");
  const tray = el("span", "demo-tray");
  tray.append(trayIcon, trayTitle);

  const harnessWindow = el("div", "demo-window demo-window--harness");
  harnessWindow.append(root, el("div", "demo-window__lights"));

  const mail = el("div", "demo-window demo-window--mail");
  const mailBar = el("div", "demo-mail__titlebar");
  mailBar.append(el("div", "demo-window__lights"), el("span", "demo-mail__title", "Inbox"));
  const list = el("div", "demo-mail__list");
  const rows = config.mail.map((thread) => {
    const row = el("div", "demo-mail__row");
    row.append(
      el("span", "demo-mail__from", thread.from),
      el("span", "demo-mail__subject", thread.subject),
      el("span", "demo-mail__snippet", thread.body),
    );
    list.appendChild(row);
    return row;
  });

  const subject = el("h2", "demo-mail__heading");
  const sender = el("p", "demo-mail__sender");
  const message = el("p", "demo-mail__message");
  const pasted = el("span", "demo-mail__pasted");
  const reply = el("p", "demo-mail__reply");
  reply.append(pasted, el("span", "demo-mail__caret"));
  const send = el("button", "demo-mail__send", "Send");
  send.type = "button";
  const pane = el("div", "demo-mail__pane");
  pane.append(subject, sender, message, reply, send);
  const split = el("div", "demo-mail__split");
  split.append(list, pane);
  mail.append(mailBar, split);

  let open = 0;
  const show = (index: number) => {
    open = index;
    const thread = config.mail[index];
    rows.forEach((row, i) => row.toggleAttribute("data-open", i === index));
    subject.textContent = thread.subject;
    sender.textContent = thread.from;
    message.textContent = thread.body;
    pasted.textContent = "";
  };
  // Sending moves on to the next message, the way working down an inbox goes.
  send.addEventListener("click", () => {
    rows[open].toggleAttribute("data-replied", true);
    if (open + 1 < config.mail.length) show(open + 1);
  });
  show(0);

  const menus = el("div", "demo-menubar__group");
  document.body.append(menuBar(menus, tray), harnessWindow, mail);

  const activate = (app: DemoApp) => {
    document.body.dataset.demoFront = app;
    const { name, items } = MENUS[app];
    menus.replaceChildren(
      el("span", "demo-menubar__app", name),
      ...items.map((item) => el("span", "demo-menubar__item", item)),
    );
  };
  activate("mail");

  const setTray = (state: DemoTrayState) => {
    tray.dataset.state = state;
    trayIcon.src = TRAY_ICONS[state];
    // The real tray sets a "REC" title beside the icon while recording.
    trayTitle.textContent = state === "recording" ? "REC" : "";
  };
  setTray("ready");

  return {
    tray: setTray,
    activate,
    paste: (text) => {
      pasted.textContent += text;
    },
  };
}
