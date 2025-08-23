import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "PlayHTML Bag",
    description:
      "Transform webpages into interactive playgrounds. Add elements and discover what others have left behind.",
    permissions: ["storage", "activeTab", "scripting", "tabs"],
    host_permissions: ["http://*/*", "https://*/*"],
    action: {
      default_title: "PlayHTML Bag",
    },
    devtools_page: "devtools/devtools.html",
    web_accessible_resources: [
      {
        resources: ["content-scripts/content.css"],
        matches: ["<all_urls>"],
      },
    ],
  },
  modules: ["@wxt-dev/module-react"],
});
