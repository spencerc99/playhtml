// ABOUTME: Vite configuration for the wewere.online site (marketing pages + experiments).
// ABOUTME: Multi-page glob discovery, @movement alias to ./shared, @extension alias for preview pages.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { glob } from "glob";
import { auditLocal } from "./scripts/auditLocal";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), auditLocal(__dirname, mode === "commute-audit")],
  ...(mode === "commute-audit" ? { publicDir: false, preview: { host: "127.0.0.1" } } : {}),
  server: {
    ...(mode === "commute-audit" ? { host: "127.0.0.1" } : {}),
    fs: { deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/private-data/**"] },
  },
  resolve: {
    alias: {
      "@movement": path.resolve(__dirname, "./shared"),
      "@extension": path.resolve(__dirname, "../src"),
      // Extension social code (bottles, inventory) imports webextension-polyfill;
      // on the site there's no extension context, so alias it to a small shim
      // (getURL → /asset paths, storage.local → localStorage). Lets the social
      // playground run the real initGlobalFeatures unchanged.
      "webextension-polyfill": path.resolve(__dirname, "./shared/webext-shim.ts"),
      playhtml: path.resolve(__dirname, "../../packages/playhtml/src/index.ts"),
      "@playhtml/react": path.resolve(__dirname, "../../packages/react/src"),
      "@playhtml/common": path.resolve(__dirname, "../../packages/common/src"),
      "@playhtml/extension-types": path.resolve(__dirname, "../../packages/extension-types/src"),
      // Bun's hoisting puts react@19 in extension/node_modules and react@18 at
      // the workspace root. Node's upward resolution from extension/website/
      // hits the @19 copy first, even though the website declares @18.3.1.
      // Force every bare `react`/`react-dom` import to the root copy so all
      // consumers (including downshift) share one React instance — otherwise
      // hooks throw "Invalid hook call".
      react: path.resolve(__dirname, "../../node_modules/react"),
      "react-dom": path.resolve(__dirname, "../../node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  build: {
    rollupOptions: {
      input: mode === "commute-audit" ? path.resolve(__dirname, "commute-audit/index.html") : glob.sync(path.resolve(__dirname, "**/*.html"), {
        ignore: ["**/node_modules/**", "**/dist/**", "**/commute-audit/**"],
      }),
    },
    emptyOutDir: true,
  },
}));
