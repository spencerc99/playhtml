import path from "path";
import { glob } from "glob";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: path.join(__dirname, "website"),
  resolve: {
    alias: {
      "@playhtml/common": path.join(__dirname, "packages/common/src"),
      "@playhtml/react": path.join(__dirname, "packages/react/src"),
      playhtml: path.join(__dirname, "packages/playhtml/src/main.ts"),
    },
  },
  optimizeDeps: {
    exclude: ["@playhtml/common", "@playhtml/react", "playhtml"],
  },
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
