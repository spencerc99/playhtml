// ABOUTME: Vitest configuration for the wewere.online website.
// ABOUTME: Mirrors the app Vite aliases so component tests use the same React copy.

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@movement": path.resolve(__dirname, "./shared"),
      "@extension": path.resolve(__dirname, "../src"),
      playhtml: path.resolve(__dirname, "../../packages/playhtml/src/index.ts"),
      "@playhtml/react": path.resolve(__dirname, "../../packages/react/src"),
      "@playhtml/common": path.resolve(__dirname, "../../packages/common/src"),
      react: path.resolve(__dirname, "../../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
