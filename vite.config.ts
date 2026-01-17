// vite.config.ts
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'PocketAgent',
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'cjs'}`,
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      // 确保外部化处理那些你不想打包进库的依赖
      external: [
        'openai', 
        'node:fs', 
        'node:path', 
        'node:child_process', 
        'node:util', 
        'fs', 
        'path', 
        'child_process', 
        'util',
        'events',
        'node:events'
      ],
      output: {
        globals: {
          openai: 'OpenAI'
        }
      }
    },
    sourcemap: true,
    minify: 'esbuild',
  },
  plugins: [
    dts({
      rollupTypes: true,
      tsconfigPath: './tsconfig.json'
    })
  ]
});
