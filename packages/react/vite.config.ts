import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: path.resolve(__dirname, "react.tsx"),
      name: "react-playhtml",
      fileName: (format) => `playhtml.${format}.js`,
    },
    outDir: "react-dist",
  },
  // temp to deal with partykit double init on hot refresh
  server: { hmr: false },
  // Ignores `public` folder for the npm packge
  publicDir: false,
});
