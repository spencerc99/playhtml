// ABOUTME: Builds the core playhtml package and generated declaration bundle.
// ABOUTME: Keeps public declarations pointed at package imports, not workspace paths.
import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

const commonSourceImport = /from ["'](?:\.\.\/)+common\/src["']/g;
const commonSourceDynamicImport = /import\(["'](?:\.\.\/)+common\/src["']\)/g;

export default defineConfig({
  plugins: [
    dts({
      rollupTypes: true,
      beforeWriteFile(filePath, content) {
        if (!filePath.endsWith("main.d.ts")) return;
        return {
          content: content
            .replace(commonSourceImport, 'from "@playhtml/common"')
            .replace(commonSourceDynamicImport, 'import("@playhtml/common")'),
        };
      },
    }),
  ],
  build: {
    // Vite's esbuild pass keeps whitespace in ES library output; terser strips
    // it, and preserve_annotations keeps pure annotations for downstream
    // tree-shaking. The package is also loaded unbundled
    // from CDNs, so ship it minified with source maps for debugging.
    minify: "terser",
    terserOptions: { format: { preserve_annotations: true } },
    sourcemap: true,
    rollupOptions: {
      input: ["src/init.ts", "src/index.ts", "src/leafEditor.ts"],
      output: {
        inlineDynamicImports: false,
      },
    },
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      name: "playhtml",
      cssFileName: "style",
      fileName: (format, entryName) => {
        if (entryName === "init") return `init.${format}.js`;
        if (entryName === "leafEditor") return `leafEditor.${format}.js`;

        return `playhtml.${format}.js`;
      },
    },
  },
});
