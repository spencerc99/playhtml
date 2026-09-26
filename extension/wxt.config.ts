// ABOUTME: WXT build configuration for the browser extension.
// ABOUTME: Defines manifest metadata, output settings, and Vite aliases.
import { defineConfig } from "wxt";
import path from "path";
import { loadEnv, type Plugin } from "vite";

/**
 * Builds without WXT_COLLAGE_ENGINE=tldraw swap the tldraw studio prototype
 * for an empty module. Its import already sits in a dead branch, but the
 * bundler still loads it and would emit tldraw's fonts and translations as
 * unused files; the swap keeps them out of the build entirely.
 */
function leaveOutTldrawStudio(): Plugin {
  const stub = "\0collage-tldraw-studio-left-out";
  return {
    name: "leave-out-tldraw-studio",
    enforce: "pre",
    resolveId(source) {
      return source.endsWith("/tldraw/TldrawCollageStudio") ? stub : null;
    },
    load(id) {
      return id === stub ? "export default null;" : null;
    },
  };
}

export default defineConfig({
  srcDir: "src",
  manifest: ({ browser }) => ({
    name: "we were online",
    description:
      "A quiet portrait of your time online. See who else is here, chat, and collect traces of where you've been.",
    permissions: [
      "storage",
      "tabs",
      "alarms",
      ...(browser === "safari" ? [] : ["idle", "webNavigation"]),
      "unlimitedStorage",
    ],
    host_permissions: ["http://*/*", "https://*/*"],
    action: {
      default_title: "we were online",
    },
    commands: {
      "open-inventory": {
        suggested_key: {
          default: "Ctrl+Shift+B", // Windows/Linux — B for bag (E is the emote wheel; Ctrl+Shift+I is DevTools)
          mac: "Command+Shift+I", // free on mac Chrome/Edge/Firefox (DevTools = Cmd+Option+I)
        },
        description: "Open the we-were-online inventory at the cursor",
      },
    },
    web_accessible_resources: [
      {
        resources: [
          "content-scripts/content.css",
          "installation.js",
          "historical-overlay.js",
          "inventory/*",
        ],
        matches: ["<all_urls>"],
      },
    ],
    browser_specific_settings: {
      gecko: {
        id: "we-were-online@spencerchang.com",
        data_collection_permissions: {
          required: ["browsingActivity", "websiteActivity"],
          optional: ["technicalAndInteraction"],
        },
      },
    },
  }),
  hooks: {
    "build:manifestGenerated": (wxt, manifest) => {
      if (wxt.config.browser === "safari" && manifest.options_ui) {
        delete manifest.options_ui.open_in_tab;
      }
    },
  },
  modules: ["@wxt-dev/module-react"],
  outDir: process.env.WXT_OUT_DIR || "dist",
  // Force ASCII output so Chrome doesn't reject content scripts as "not UTF-8
  // encoded" — esbuild can emit non-ASCII characters in string literals which
  // Chrome's manifest loader misidentifies as invalid encoding.
  vite: (env) => ({
    plugins:
      loadEnv(env.mode, __dirname, "WXT_").WXT_COLLAGE_ENGINE === "tldraw"
        ? []
        : [leaveOutTldrawStudio()],
    esbuild: {
      charset: "ascii",
    },
    // tldraw's asset list imports each font and icon with `?url`. The dev
    // server's dependency pre-bundling drops those imports, which leaves the
    // list with undefined entries, so the package is served as-is instead.
    optimizeDeps: {
      exclude: ["@tldraw/assets"],
    },
    resolve: {
      alias: {
        "@extension": path.resolve(__dirname, "src"),
        "@movement": path.resolve(__dirname, "website/shared"),
        "@playhtml/extension-types": path.resolve(
          __dirname,
          "../packages/extension-types/src/index.ts",
        ),
      },
    },
  }),
});
