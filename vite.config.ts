import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts()],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/main.ts"),
      name: "open-websites",
      fileName: (format) => `open-websites.${format}.js`,
    },
  },
});
