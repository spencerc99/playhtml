// ABOUTME: Vitest config for the client performance benchmark.
// ABOUTME: Reuses the unit-test setup (provider fakes) but only runs bench files.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import path from "node:path";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      "@playhtml/common": path.resolve(rootDir, "../common/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [path.resolve(rootDir, "vitest.setup.ts")],
    include: ["bench/**/*.perf.ts"],
    testTimeout: 120_000,
  },
});
