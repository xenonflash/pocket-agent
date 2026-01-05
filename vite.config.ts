import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts()],
  build: {
    lib: {
      entry: "src/index.ts",
      name: "PocketAgent",
      fileName: (format) => `pocket-agent.${format}.js`,
      formats: ["es", "cjs", "umd"]
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {}
      }
    }
  }
});
