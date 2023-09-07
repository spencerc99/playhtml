import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/main.ts"),
      name: "playhtml",
      fileName: (format) => `playhtml.${format}.js`,
    },
  },
});
