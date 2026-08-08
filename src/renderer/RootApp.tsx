import { useEffect, useState } from "react";
import App from "./App";
import { WindowedNoteView } from "./WindowedNoteView";
import { getCurrentWindowLabel, noteIdFromStickyWindowLabel } from "./stickyWindow";

type RootRoute =
  | { kind: "loading" }
  | { kind: "main" }
  | { kind: "sticky"; noteId: string };

export function RootApp() {
  const [route, setRoute] = useState<RootRoute>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const label = await getCurrentWindowLabel();
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
  return <App />;
}
