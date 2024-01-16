import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: [
        path.resolve(__dirname, "index.html"),
        path.resolve(__dirname, "story.html"),
        path.resolve(__dirname, "fridge.html"),
        path.resolve(__dirname, "candles.html"),
        path.resolve(__dirname, "playground.html"),
      ],
    },
    outDir: "site-dist",
  },
});
