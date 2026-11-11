// ABOUTME: The site's Vite config minus dev-only overlays (copy editor, feedback toolbar),
// ABOUTME: so the filming copy looks like production on camera.

import { defineConfig, mergeConfig, type PluginOption } from "vite";
import siteConfig from "../../vite.config.site.mts";

const hiddenOnCamera = new Set(["directedit", "playhtml:agentation"]);

function withoutOverlays(plugins: PluginOption[] = []): PluginOption[] {
  return plugins.flat().filter((plugin) => {
    if (!plugin || typeof plugin !== "object" || !("name" in plugin)) {
      return true;
    }
    return !hiddenOnCamera.has(plugin.name);
  });
}

export default defineConfig({
  ...mergeConfig(siteConfig, {}),
  plugins: withoutOverlays(siteConfig.plugins),
});
