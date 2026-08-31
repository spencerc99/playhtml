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
    setupFiles: ["../playhtml/vitest.setup.ts"],
    include: ["src/**/__tests__/*.integration.test.tsx"],
    exclude: ["node_modules/**", "dist/**"],
  },
  resolve: {
    alias: {
      playhtml: path.resolve(__dirname, "../playhtml/src/index.ts"),
      "@playhtml/common": path.resolve(__dirname, "../common/src/index.ts"),
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
