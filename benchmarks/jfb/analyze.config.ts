import { defineConfig } from 'vite';
import { volt } from '@volt/vite-plugin';
import { resolve } from 'node:path';

/** Same build as the benchmark entry, unminified, for size analysis. */
export default defineConfig({
  root: import.meta.dirname,
  plugins: [volt()],
  build: {
    target: 'esnext',
    minify: false,
    outDir: resolve(import.meta.dirname, 'analyze'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/main.ts'),
      output: { entryFileNames: 'main.js', format: 'es' },
    },
  },
});
