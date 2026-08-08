import type { Preview } from "@storybook/react-vite";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../src/renderer/base.css";
import "../src/renderer/modal.css";
import "../src/renderer/setupNotice.css";
import "../src/renderer/sidebar.css";
import "../src/renderer/chat.css";
import "../src/renderer/workspaceShell.css";
import "../src/renderer/settings.css";
import "../src/renderer/tasks.css";
import "../src/renderer/search.css";
import "../src/renderer/notes.css";
import "../src/renderer/images.css";
import "../src/renderer/stickyNote.css";
import "highlight.js/styles/github-dark.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    backgrounds: {
      default: "harness",
      values: [
        { name: "harness", value: "#111" },
        { name: "elevated", value: "#222" },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
