// ABOUTME: Builds the core playhtml package and generated declaration bundle.
// ABOUTME: Keeps public declarations pointed at package imports, not workspace paths.
import path from "path";
import { transform } from "esbuild";
import { defineConfig, type Plugin } from "vite";
import dts from "vite-plugin-dts";

const commonSourceImport = /from ["'](?:\.\.\/)+common\/src["']/g;
const commonSourceDynamicImport = /import\(["'](?:\.\.\/)+common\/src["']\)/g;

// Vite leaves whitespace in ES library output so downstream bundlers keep
// pure annotations. esbuild keeps those annotations while stripping whitespace,
// and the package is also loaded unbundled from CDNs, so strip it here.
function minifyWhitespace(): Plugin {
  return {
    name: "playhtml-minify-whitespace",
    async renderChunk(code) {
      const result = await transform(code, {
        format: "esm",
        minifyWhitespace: true,
        sourcemap: true,
      });
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  plugins: [
    minifyWhitespace(),
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
