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
    rollupOptions: {
      input: ["src/init.ts", "src/index.ts"],
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

        return `playhtml.${format}.js`;
      },
    },
  },
});
