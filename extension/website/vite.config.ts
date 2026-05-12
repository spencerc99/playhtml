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
      // Bun's hoisting puts react@19 in extension/node_modules and react@18 at
      // the workspace root. Node's upward resolution from extension/website/
      // hits the @19 copy first, even though the website declares @18.3.1.
      // Force every bare `react`/`react-dom` import to the root copy so all
      // consumers (including downshift) share one React instance — otherwise
      // hooks throw "Invalid hook call".
      react: path.resolve(__dirname, "../../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
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
