import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts()],

  build: {
    rollupOptions: {
      input: [
        path.resolve(__dirname, "index.html"),
        path.resolve(__dirname, "story.html"),
        path.resolve(__dirname, "fridge.html"),
      ],
    },
    outDir: "site-dist",
  },
});
