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
      external: ["react", "react-dom"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
      },
    },
  },
});
