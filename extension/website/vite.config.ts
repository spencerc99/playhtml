// ABOUTME: Vite configuration for the wewere.online homepage.
// ABOUTME: Sets up React plugin, path aliases, and multi-page build with glob-based HTML discovery.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { glob } from "glob";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@movement": path.resolve(__dirname, "../../website/internet-series/movement"),
    },
  },
  build: {
    rollupOptions: {
      input: glob.sync(path.resolve(__dirname, "*.html")),
    },
    emptyOutDir: true,
  },
});
