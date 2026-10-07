import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import path from "node:path";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const setupFile = fileURLToPath(new URL("./vitest.setup.ts", import.meta.url));

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      // Resolve workspace siblings to their source so tests pick up changes
      // without a rebuild. Without this, tests import the stale
      // packages/common/dist which only updates on `bun run build`.
      "@playhtml/common": path.resolve(rootDir, "../common/src/index.ts"),
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
