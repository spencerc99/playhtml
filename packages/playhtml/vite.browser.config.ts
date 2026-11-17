// ABOUTME: Builds the single-file browser bundle served for bare CDN URLs.
// ABOUTME: jsDelivr serves the package entry without redirecting, so it can't import sibling chunks.
import path from "path";
import { defineConfig } from "vite";

// `cdn.jsdelivr.net/npm/playhtml` serves the file named by the `jsdelivr`
// field in package.json directly at that URL. Relative chunk imports would
// resolve against `/npm/` and 404, so this build inlines every dynamic import.
export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: "terser",
    terserOptions: { format: { preserve_annotations: true } },
    sourcemap: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      name: "playhtml",
      cssFileName: "style",
      fileName: () => "playhtml.browser.js",
    },
  },
});
