import type { DevView } from "../sidebarUtils";
import { DevChatView, DevDictationView, DevPlaceholderView } from "./devPlayground";

/**
 * Single lazy entry point for the dev playground. Routing through one default
 * export keeps the playground in its own chunk, and lets `import.meta.env.DEV`
 * fold the dynamic import away entirely in production builds.
 */
export default function DevViewHost({ view }: { view: DevView }) {
  switch (view) {
    case "dev-chat":
      return <DevChatView />;
    case "dev-dictation":
      return <DevDictationView />;
    case "dev-note":
      return <DevPlaceholderView kind="note" />;
    case "dev-image":
      return <DevPlaceholderView kind="image" />;
  }
}
