// ABOUTME: Configures React integration tests against the initialized PlayHTML runtime.
// ABOUTME: Reuses the core package's deterministic browser provider fakes.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: [path.resolve(__dirname, "../playhtml/vitest.setup.ts")],
    include: ["src/__tests__/function-defaults.integration.test.tsx"],
  },
  resolve: {
    alias: {
      "@playhtml/common": path.resolve(__dirname, "../common/src/index.ts"),
      playhtml: path.resolve(__dirname, "../playhtml/src/index.ts"),
      "react/jsx-runtime": path.resolve(
        __dirname,
        "../../node_modules/react/jsx-runtime",
      ),
      "react/jsx-dev-runtime": path.resolve(
        __dirname,
        "../../node_modules/react/jsx-dev-runtime",
      ),
      "react-dom/test-utils": path.resolve(
        __dirname,
        "../../node_modules/react-dom/test-utils",
      ),
      "react-dom/client": path.resolve(
        __dirname,
        "../../node_modules/react-dom/client",
      ),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
      react: path.resolve(__dirname, "../../node_modules/react"),
    },
  },
});
