// ABOUTME: Configures the docs-site integration tests for runnable code snippets.
// ABOUTME: Resolves workspace packages to source so docs examples test current code.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const setupFile = fileURLToPath(new URL("./vitest.setup.ts", import.meta.url));

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      playhtml: path.resolve(rootDir, "../../packages/playhtml/src/index.ts"),
      "@playhtml/common": path.resolve(
        rootDir,
        "../../packages/common/src/index.ts",
      ),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    // Node 22+ defines its own global localStorage that shadows jsdom's and
    // is undefined without --localstorage-file. Disable it in test workers.
    poolOptions: {
      forks: { execArgv: ["--no-experimental-webstorage"] },
      threads: { execArgv: ["--no-experimental-webstorage"] },
    },
    exclude: ["node_modules/**", "dist/**"],
    setupFiles: [setupFile],
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
