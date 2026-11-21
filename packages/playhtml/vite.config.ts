// ABOUTME: Builds the core playhtml package and generated declaration bundle.
// ABOUTME: Keeps public declarations pointed at package imports, not workspace paths.
import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// The declaration bundler follows the alias below and writes paths into the
// common package's source, with or without the file name.
const commonSourceImport =
  /from ["'](?:\.\.\/)+common\/src(?:\/index(?:\.ts)?)?["']/g;
const commonSourceDynamicImport =
  /import\(["'](?:\.\.\/)+common\/src(?:\/index(?:\.ts)?)?["']\)/g;

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
  // These files are also loaded straight from CDNs, with no bundler after them
  // to fill in Node's `process`. A dependency that reads `process.env.NODE_ENV`
  // would otherwise throw "process is not defined" on load.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: {
    // Bundle @playhtml/common from its source files, not its one-file build,
    // so the parts only version 2 uses can go in the chunk that loads on demand.
    alias: {
      "@playhtml/common": path.resolve(__dirname, "../common/src/index.ts"),
    },
  },
  build: {
    // Vite's esbuild pass keeps whitespace in ES library output; terser strips
    // it, and preserve_annotations keeps pure annotations for downstream
    // tree-shaking. The package is also loaded unbundled
    // from CDNs, so ship it minified with source maps for debugging.
    minify: "terser",
    terserOptions: { format: { preserve_annotations: true } },
    sourcemap: true,
    rollupOptions: {
      // The protocol files run setup code when they load. Without this, that
      // setup pins them to the main chunk even though only version 2 calls
      // them; with it, they are left out of any chunk that uses nothing from
      // them and still run their setup in the chunk that does.
      treeshake: {
        moduleSideEffects: (id) => !id.includes("/common/src/protocol/"),
      },
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
