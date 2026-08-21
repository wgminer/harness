import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, "dist-web"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/renderer/index.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // CodeMirror only loads with the notes editor; highlight.js and the
          // markdown pipeline are shared by chat and notes.
          if (id.includes("@codemirror") || id.includes("@lezer") || id.includes("codemirror")) {
            return "codemirror";
          }
          if (
            id.includes("react-markdown") ||
            id.includes("remark") ||
            id.includes("rehype") ||
            id.includes("highlight.js") ||
            id.includes("lowlight") ||
            id.includes("micromark") ||
            id.includes("mdast") ||
            id.includes("hast")
          ) {
            return "markdown";
          }
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
});
