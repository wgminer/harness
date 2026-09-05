import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Browser debug shell (`npm run dev:browser`) — OpenAI does not allow browser CORS.
      "/openai": {
        target: "https://api.openai.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/openai/, ""),
      },
    },
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
      },
    },
  },
});
