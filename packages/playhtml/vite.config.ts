import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  build: {
    // TODO: figure out how to fix this for also building init file
    // rollupOptions: {
    //   input: ["src/init.ts", "src/main.ts"],
    //   output: {
    //     inlineDynamicImports: false,
    //   },
    // },
    lib: {
      entry: path.resolve(__dirname, "src/main.ts"),
      formats: ["es", "umd"],
      name: "playhtml",
      fileName: (format, entryName) => {
        if (entryName === "init") return `init.${format}.js`;

        return `playhtml.${format}.js`;
      },
    },
  },
});
