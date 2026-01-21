import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "Tiny Internets",
    description:
      "Turn the internet into an multiplayer playground. Add elements and discover what others have left behind.",
    permissions: ["storage", "activeTab", "scripting", "tabs"],
    host_permissions: ["http://*/*", "https://*/*"],
    action: {
      default_title: "Tiny Internets",
    },
    web_accessible_resources: [
      {
        resources: ["content-scripts/content.css"],
        matches: ["<all_urls>"],
      },
    ],
  },
  modules: ["@wxt-dev/module-react"],
  outDir: "dist",
});
