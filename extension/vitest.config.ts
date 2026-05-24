// ABOUTME: Vitest configuration for the browser extension test suite.
// ABOUTME: Sets up jsdom environment, test file patterns, and setup file paths.

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const setupFile = fileURLToPath(new URL("./vitest.setup.ts", import.meta.url));
const extensionSrc = fileURLToPath(new URL("./src", import.meta.url));
const movementShared = fileURLToPath(new URL("./website/shared", import.meta.url));
const extensionTypesSrc = fileURLToPath(
  new URL("../packages/extension-types/src/index.ts", import.meta.url),
);

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      "@extension": extensionSrc,
      "@movement": movementShared,
      "@playhtml/extension-types": extensionTypesSrc,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    exclude: ["node_modules/**", "dist/**", ".output/**"],
    setupFiles: [setupFile],
    include: [
      "src/__tests__/**/*.test.ts",
      "src/__tests__/**/*.test.tsx",
      "website/shared/**/*.test.ts",
      "website/shared/**/*.test.tsx",
    ],
  },
});
