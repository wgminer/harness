import { useEffect, useState } from "react";
import App from "./App";
import { WindowedNoteView } from "./notes/WindowedNoteView";
import { FileWindowView } from "./notes/FileWindowView";
import { getCurrentWindowLabel, noteIdFromStickyWindowLabel } from "./notes/stickyWindow";
import { useTimeOfDayBackground } from "./hooks/useTimeOfDayBackground";

type RootRoute =
  | { kind: "loading" }
  | { kind: "main" }
  | { kind: "sticky"; noteId: string }
  | { kind: "file"; path: string };

export function RootApp() {
  useTimeOfDayBackground();
  const [route, setRoute] = useState<RootRoute>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const label = await getCurrentWindowLabel();
      const filePath = new URLSearchParams(window.location.search).get("file");
      if (!cancelled && label?.startsWith("file-") && filePath) {
        setRoute({ kind: "file", path: filePath });
        return;
      }
      const noteId = label ? noteIdFromStickyWindowLabel(label) : null;
      if (!cancelled && noteId) {
        setRoute({ kind: "sticky", noteId });
        return;
      }
      if (!cancelled) {
        setRoute({ kind: "main" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (route.kind === "loading") {
    return (
      <div className="harness-boot" data-testid="harness-boot" role="status" aria-label="Harness">
        <span className="harness-boot__wordmark">Harness</span>
      </div>
    );
  }
  if (route.kind === "sticky") {
    return <WindowedNoteView noteId={route.noteId} />;
  }
  if (route.kind === "file") {
    return <FileWindowView path={route.path} />;
  }
  return <App />;
}
