import { useEffect, useState } from "react";
import App from "./App";
import { StickyNoteView } from "./StickyNoteView";
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
    return null;
  }
  if (route.kind === "sticky") {
    return <StickyNoteView noteId={route.noteId} />;
  }
  return <App />;
}
