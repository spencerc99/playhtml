import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "we were online",
    description:
      "A quiet portrait of your time on the internet. Collect traces of where you've been and share them anonymously.",
    permissions: ["storage", "tabs"],
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
  },
  modules: ["@wxt-dev/module-react"],
  outDir: "dist",
});
