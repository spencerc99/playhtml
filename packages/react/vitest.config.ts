import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Deduplicate React so tests use a single instance. The local
      // node_modules has React 19 while the root has React 18; force everything
      // to resolve to the root's React 18 which @testing-library/react also uses.
      "react/jsx-runtime": path.resolve(__dirname, "../../node_modules/react/jsx-runtime"),
      "react/jsx-dev-runtime": path.resolve(__dirname, "../../node_modules/react/jsx-dev-runtime"),
      "react-dom/test-utils": path.resolve(__dirname, "../../node_modules/react-dom/test-utils"),
      "react-dom/client": path.resolve(__dirname, "../../node_modules/react-dom/client"),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
      "react": path.resolve(__dirname, "../../node_modules/react"),
    },
  },
});
