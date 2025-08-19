import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const setupFile = fileURLToPath(new URL("./vitest.setup.ts", import.meta.url));

export default defineConfig({
  root: rootDir,
  test: {
    globals: true,
    environment: "jsdom",
    exclude: ["node_modules/**", "dist/**"],
    setupFiles: [setupFile],
    include: ["src/__tests__/**/*.test.ts"],
  },
});
