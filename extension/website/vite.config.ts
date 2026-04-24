// ABOUTME: Vite configuration for the wewere.online site (marketing pages + experiments).
// ABOUTME: Multi-page glob discovery, @movement alias to ./shared, @extension alias for preview pages.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { glob } from "glob";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@movement": path.resolve(__dirname, "./shared"),
      "@extension": path.resolve(__dirname, "../src"),
      playhtml: path.resolve(__dirname, "../../packages/playhtml/src/index.ts"),
      "@playhtml/react": path.resolve(__dirname, "../../packages/react/src"),
      "@playhtml/common": path.resolve(__dirname, "../../packages/common/src"),
    },
  },
  build: {
    rollupOptions: {
      input: glob.sync(path.resolve(__dirname, "**/*.html"), {
        ignore: ["**/node_modules/**", "**/dist/**"],
      }),
    },
    emptyOutDir: true,
  },
});
