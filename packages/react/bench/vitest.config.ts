// ABOUTME: Vitest config for the React render benchmark against the real playhtml core.
// ABOUTME: Reuses the integration setup (provider fakes) but only runs bench files.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: path.resolve(__dirname, ".."),
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
    setupFiles: [path.resolve(__dirname, "../../playhtml/vitest.setup.ts")],
    include: ["bench/**/*.perf.tsx"],
    testTimeout: 120_000,
    exclude: ["node_modules/**", "dist/**"],
  },
  resolve: {
    alias: {
      playhtml: path.resolve(__dirname, "../../playhtml/src/index.ts"),
      "@playhtml/common": path.resolve(__dirname, "../../common/src/index.ts"),
      "react/jsx-runtime": path.resolve(
        __dirname,
        "../../../node_modules/react/jsx-runtime",
      ),
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "../../../node_modules/react/jsx-dev-runtime",
      ),
      "react-dom/test-utils": path.resolve(
        __dirname,
        "../../../node_modules/react-dom/test-utils",
      ),
      "react-dom/client": path.resolve(
        __dirname,
        "../../../node_modules/react-dom/client",
      ),
      "react-dom": path.resolve(__dirname, "../../../node_modules/react-dom"),
      react: path.resolve(__dirname, "../../../node_modules/react"),
    },
  },
});
