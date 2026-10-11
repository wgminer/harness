import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ChevronDown, RotateCw, Trash2 } from "lucide-react";
import type { TerminalDataChunk } from "../../shared/desktopAPI";
import { isTerminalToggleKey } from "./terminalOpenStore";
import "./terminal.css";

interface TerminalPanelProps {
  conversationId: string;
  /** Hide the panel; the shell keeps running. */
  onHide: () => void;
}

type Status = "starting" | "running" | "exited" | "error";

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function cwdLabel(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

export function TerminalPanel({ conversationId, onHide }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);
  const [cwd, setCwd] = useState("");
  const [restartNonce, setRestartNonce] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setStatus("starting");
    setError(null);

    const styles = getComputedStyle(host);
    const term = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      fontFamily: styles.getPropertyValue("--font-family-mono").trim() || "monospace",
      fontSize: 12,
      scrollback: 5000,
      theme: {
        background: "#00000000",
        foreground: styles.getPropertyValue("--fg").trim() || "#ccc",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    term.attachCustomKeyEventHandler((e) => !isTerminalToggleKey(e));

    const fitToHost = () => {
      // Hidden hosts measure 0; fitting then would shrink the shell to one column.
      if (host.offsetWidth === 0 || host.offsetHeight === 0) return;
      fit.fit();
    };
    fitToHost();

    let disposed = false;
    // Chunks that land before the snapshot; the offset says which the snapshot already holds.
    let pending: TerminalDataChunk[] | null = [];
    let endOffset = 0;
    const api = window.harness.terminal;

    const offData = api.onData((chunk) => {
      if (chunk.conversationId !== conversationId) return;
      if (pending) {
        pending.push(chunk);
        return;
      }
      if (chunk.offset >= endOffset) term.write(decodeBase64(chunk.data));
    });
    const offExit = api.onExit((id) => {
      if (id === conversationId) setStatus("exited");
    });

    api
      .open(conversationId, term.cols, term.rows)
      .then((snapshot) => {
        if (disposed) return;
        endOffset = snapshot.endOffset;
        if (snapshot.scrollback) term.write(decodeBase64(snapshot.scrollback));
        for (const chunk of pending ?? []) {
          if (chunk.offset >= endOffset) term.write(decodeBase64(chunk.data));
        }
        pending = null;
        setCwd(snapshot.cwd);
        setStatus("running");
        term.focus();
      })
      .catch((e: unknown) => {
        if (disposed) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });

    const inputSub = term.onData((data) => {
      void api.write(conversationId, data).catch(() => {});
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      void api.resize(conversationId, cols, rows).catch(() => {});
    });
    const observer = new ResizeObserver(fitToHost);
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      offData();
      offExit();
      inputSub.dispose();
      resizeSub.dispose();
      term.dispose();
    };
  }, [conversationId, restartNonce]);

  const endSession = () => {
    void window.harness.terminal.close(conversationId).catch(() => {});
    onHide();
  };

  return (
    <section className="terminal-panel" aria-label="Terminal" data-testid="terminal-panel">
      <header className="terminal-panel__header">
        <span className="terminal-panel__title" title={cwd || undefined}>
          {status === "exited" ? "Shell exited" : cwd ? cwdLabel(cwd) : "Terminal"}
        </span>
        {status === "exited" ? (
          <button
            type="button"
            className="btn btn-icon chat-pane-btn chat-pane-btn--icon"
            onClick={() => setRestartNonce((n) => n + 1)}
            title="Start a new shell"
            aria-label="Start a new shell"
          >
            <RotateCw size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-icon chat-pane-btn chat-pane-btn--icon"
          onClick={endSession}
          title="End this shell"
          aria-label="End this shell"
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          className="btn btn-icon chat-pane-btn chat-pane-btn--icon"
          onClick={onHide}
          title="Hide terminal (Ctrl+`)"
          aria-label="Hide terminal"
        >
          <ChevronDown size={14} />
        </button>
      </header>
      {error ? <p className="terminal-panel__error">{error}</p> : null}
      <div ref={hostRef} className="terminal-panel__host" hidden={!!error} />
    </section>
  );
}
