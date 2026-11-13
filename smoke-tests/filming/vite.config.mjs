// ABOUTME: The site's Vite config minus dev-only overlays (copy editor, feedback toolbar),
// ABOUTME: so the filming copy looks like production on camera.

import { defineConfig } from "vite";
import siteConfig from "../../vite.config.site.mts";

const hiddenOnCamera = new Set(["directedit", "playhtml:agentation"]);

export default defineConfig({
  ...siteConfig,
  plugins: (siteConfig.plugins ?? [])
    .flat()
    .filter((plugin) => !hiddenOnCamera.has(plugin?.name)),
});
