// ABOUTME: Vitest configuration for the browser extension test suite.
// ABOUTME: Sets up jsdom environment, test file patterns, and setup file paths.

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const setupFile = fileURLToPath(new URL("./vitest.setup.ts", import.meta.url));
const extensionSource = fileURLToPath(new URL("./src", import.meta.url));
const playhtmlSource = fileURLToPath(new URL("../packages/playhtml/src/index.ts", import.meta.url));
const extensionTypesSource = fileURLToPath(
  new URL("../packages/extension-types/src/index.ts", import.meta.url),
);

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      "@extension": extensionSource,
      playhtml: playhtmlSource,
      "@playhtml/extension-types": extensionTypesSource,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    exclude: ["node_modules/**", "dist/**", ".output/**"],
    setupFiles: [setupFile],
    include: [
      "src/__tests__/**/*.test.ts",
      "website/shared/**/*.test.ts",
      "website/shared/**/*.test.tsx",
    ],
  },
});
