import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: [
        path.resolve(__dirname, "src/main.ts"),
        path.resolve(__dirname, "src/init.ts"),
      ],
      name: "playhtml",
      fileName: (format, entryName) => {
        if (entryName === "init") return `init.${format}.js`;

        return `playhtml.${format}.js`;
      },
    },
  },
});
