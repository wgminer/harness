import type { Preview } from "@storybook/react-vite";
import "../src/renderer/base.css";
import "../src/renderer/ui/modal.css";
import "../src/renderer/ui/menu.css";
import "../src/renderer/setup/setupNotice.css";
import "../src/renderer/sidebar/sidebar.css";
import "../src/renderer/chat/chat.css";
import "../src/renderer/workspaceShell.css";
import "../src/renderer/settings/settings.css";
import "../src/renderer/tasks/tasks.css";
import "../src/renderer/search/search.css";
import "../src/renderer/notes/notes.css";
import "../src/renderer/images/images.css";
import "../src/renderer/notes/stickyNote.css";
import "highlight.js/styles/github-dark.css";
import "./preview.css";

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
