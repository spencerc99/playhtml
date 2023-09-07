import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ rollupTypes: true })],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.tsx"),
      name: "react-playhtml",
      fileName: (format) => `react-playhtml.${format}.js`,
    },
  },
  // temp to deal with partykit double init on hot refresh
  server: { hmr: false },
  // Ignores `public` folder for the npm packge
  publicDir: false,
});
