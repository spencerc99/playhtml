import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import react from "@vitejs/plugin-react";

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
    }),
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.tsx"),
      name: "react-playhtml",
      fileName: (format) => `react-playhtml.${format}.js`,
    },
    rollupOptions: {
      // Externalize peer/runtime deps so the React package doesn't re-bundle
      // the entire playhtml core (and with it yjs, syncedstore, and lit-html).
      // Consumers already install `playhtml` via peerDependencies; it's resolved
      // at their build time. This keeps lit-html out of @playhtml/react.
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "playhtml",
        "@playhtml/common",
        "classnames",
      ],
      output: {
        globals: {
          "react-dom": "ReactDom",
          react: "React",
          "react/jsx-runtime": "ReactJsxRuntime",
          playhtml: "playhtml",
          "@playhtml/common": "playhtmlCommon",
          classnames: "classNames",
        },
      },
    },
  },
});
