import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "we were online",
    description:
      "A quiet portrait of your time on the internet. Collect traces of where you've been and share them anonymously.",
    permissions: ["storage", "tabs", "alarms", "idle"],
    host_permissions: ["http://*/*", "https://*/*"],
    action: {
      default_title: "we were online",
    },
    web_accessible_resources: [
      {
        resources: ["content-scripts/content.css"],
        matches: ["<all_urls>"],
      },
    ],
    // Add options page to host first-time setup
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    browser_specific_settings: {
      gecko: {
        id: "we-were-online@spencerchang.com",
        data_collection_permissions: {
          required: ["browsingActivity", "websiteActivity"],
          optional: ["technicalAndInteraction"],
        },
      },
    },
  },
  modules: ["@wxt-dev/module-react"],
  outDir: "dist",
  // Force ASCII output so Chrome doesn't reject content scripts as "not UTF-8
  // encoded" — esbuild can emit non-ASCII characters in string literals which
  // Chrome's manifest loader misidentifies as invalid encoding.
  vite: () => ({
    esbuild: {
      charset: "ascii",
    },
  }),
});
