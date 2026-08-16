import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';
import { resolve } from 'node:path';

/**
 * Builds the js-framework-benchmark entry.
 *
 * It lives in this workspace rather than in the benchmark checkout so the
 * Volt plugin and its dependencies resolve through pnpm; the bundle is copied
 * into the harness afterwards.
 */
export default defineConfig({
  root: import.meta.dirname,
  // `VOLT_GROUP_ROWS=1` builds the shape where a row's bindings share one
  // effect, so the two can be measured against each other from one checkout.
  plugins: [volt({ groupRowBindings: process.env.VOLT_GROUP_ROWS === '1' })],
  build: {
    target: 'esnext',
    minify: 'terser',
    sourcemap: true,
    terserOptions: {
      compress: { passes: 3, unsafe_arrows: true, unsafe_methods: true, booleans_as_integers: true },
      mangle: { toplevel: true },
      format: { comments: false },
    },
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'src/main.ts'),
      output: { entryFileNames: 'main.js', format: 'es' },
    },
  },
});
