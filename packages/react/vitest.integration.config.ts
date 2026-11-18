// ABOUTME: Configures React integration tests to exercise the real playhtml core.
// ABOUTME: Uses deterministic provider fakes while preserving production binding behavior.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    // Node 22+ defines its own global localStorage that shadows jsdom's and
    // is undefined without --localstorage-file. Disable it in test workers.
    poolOptions: {
      forks: { execArgv: ["--no-experimental-webstorage"] },
      threads: { execArgv: ["--no-experimental-webstorage"] },
    },
    setupFiles: ["../playhtml/vitest.setup.ts"],
    include: ["src/**/__tests__/*.integration.test.tsx"],
    exclude: ["node_modules/**", "dist/**"],
  },
  resolve: {
    alias: {
      playhtml: path.resolve(__dirname, "../playhtml/src/index.ts"),
      "@playhtml/common": path.resolve(__dirname, "../common/src/index.ts"),
    },
  },
});
