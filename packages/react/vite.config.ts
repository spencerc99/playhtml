// ABOUTME: Builds the React bindings and their generated declaration bundle.
// ABOUTME: Keeps public declarations pointed at package imports, not workspace paths.
import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import react from "@vitejs/plugin-react";

const playhtmlSourceImport = /from ["']\.\.\/\.\.\/playhtml\/src["']/g;
const playhtmlSourceDynamicImport =
  /import\(["']\.\.\/\.\.\/playhtml\/src["']\)/g;
const reactNamespaceExportBlock =
  /declare namespace React_2 \{\r?\n    export \{\r?\n(?:        .+\r?\n)+    \}\r?\n\}\r?\n\r?\n/g;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    dts({
      rollupTypes: true,
      exclude: [
        "**/__tests__/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.spec.tsx",
      ],
      beforeWriteFile(filePath, content) {
        if (!filePath.endsWith("main.d.ts")) return;
        return {
          content: content
            .replace(
              "import { JSX as JSX_2 } from 'react/jsx-runtime';",
              `import { JSX as JSX_2 } from 'react/jsx-runtime';\nimport type * as React_2 from "react";`,
            )
            .replace(playhtmlSourceImport, 'from "playhtml"')
            .replace(playhtmlSourceDynamicImport, 'import("playhtml")')
            .replace(reactNamespaceExportBlock, "")
            .replace(/\bJSX\.Element\b/g, "JSX_2.Element"),
        };
      },
    }),
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.tsx"),
      name: "react-playhtml",
      fileName: (format) => `react-playhtml.${format}.js`,
    },
    rollupOptions: {
      external: ["playhtml", "react", "react-dom", "react/jsx-runtime"],
      output: {
        globals: {
          playhtml: "playhtml",
          "react-dom": "ReactDom",
          react: "React",
          "react/jsx-runtime": "ReactJsxRuntime",
        },
      },
    },
  },
});
