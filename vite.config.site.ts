import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts()],

  build: {
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
    },
    outDir: "site",
  },
});
