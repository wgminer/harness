import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "..");

const config: StorybookConfig = {
  stories: ["../src/renderer/**/*.stories.@(ts|tsx)"],
  addons: [],
  framework: "@storybook/react-vite",
  async viteFinal(config) {
    // App vite.config sets root to src/renderer for Tauri; Storybook needs the repo root.
    return mergeConfig(config, {
      root: projectRoot,
      resolve: {
        alias: {
          "@shared": path.resolve(projectRoot, "src/shared"),
        },
      },
    });
  },
};

export default config;
