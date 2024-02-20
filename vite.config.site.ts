import path from "path";
import { glob } from "glob";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: path.join(__dirname, "website"),
  build: {
    rollupOptions: {
      input: glob.sync(path.resolve(__dirname, "website", "**/*.html"), {
        ignore: ["**/test/**"],
      }),
    },
    outDir: path.join(__dirname, "site-dist"),
    emptyOutDir: true,
  },
  plugins: [react()],
});
