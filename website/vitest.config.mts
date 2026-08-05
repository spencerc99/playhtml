// ABOUTME: Vitest config for website tests — mirrors the site build's path aliases.
// ABOUTME: Needed so tests can import @movement/@playhtml/playhtml the same way the app does.

import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const root = path.resolve(__dirname, "..");

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
  },
  resolve: {
    alias: {
      "@playhtml/common": path.join(root, "packages/common/src"),
      "@playhtml/react": path.join(root, "packages/react/src"),
      "playhtml/leafEditor": path.join(root, "packages/playhtml/src/leafEditor.ts"),
      playhtml: path.join(root, "packages/playhtml/src/index.ts"),
      "@moderation": path.join(root, "partykit/moderation.ts"),
      "@extension": path.join(root, "extension/src"),
      "@movement": path.join(root, "extension/website/shared"),
    },
  },
});
