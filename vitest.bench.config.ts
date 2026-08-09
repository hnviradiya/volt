import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { volt } from '@voltjs/vite-plugin';

const root = import.meta.dirname;

/** Benchmarks run separately: they are slow and are not a correctness gate. */
export default defineConfig({
  // The real plugin, so the benchmark measures what production ships:
  // templates compiled at build time, not through the runtime compiler.
  plugins: [volt()],
  resolve: {
    alias: {
      '@voltjs/reactivity': resolve(root, 'packages/reactivity/src/index.ts'),
      '@voltjs/compiler': resolve(root, 'packages/compiler/src/index.ts'),
      '@voltjs/core/runtime': resolve(root, 'packages/core/src/runtime.ts'),
      '@voltjs/core/jit': resolve(root, 'packages/core/src/jit.ts'),
      '@voltjs/core': resolve(root, 'packages/core/src/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['benchmarks/test/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    globals: false,
    fileParallelism: false,
  },
});
