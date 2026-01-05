import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.json',
      rollupTypes: true,
      exclude: ['**/*.test.ts', '**/*.example.ts']
    })
  ],
  build: {
    target: 'node18',
    lib: {
      entry: "src/index.ts",
      name: "PocketAgent",
      fileName: (format) => {
        if (format === 'es') return 'index.mjs';
        if (format === 'cjs') return 'index.cjs';
        return 'index.js';
      },
      formats: ["es", "cjs"]
    },
    rollupOptions: {
      external: ['openai', 'fs', 'path'],
      output: {
        globals: {
          openai: 'OpenAI',
          fs: 'fs',
          path: 'path'
        }
      }
    }
  }
});
