import { defineConfig, type Plugin } from 'vitest/config';
import { resolve } from 'node:path';
import { transform } from 'esbuild';

const root = import.meta.dirname;

/** Same decorator lowering as the main config; see vitest.config.ts. */
function decorators(): Plugin {
  return {
    name: 'volt:decorators',
    enforce: 'pre',
    async transform(code, id) {
      if (!/\.m?ts$/.test(id.split('?')[0] ?? id)) return null;
      if (!/^\s*@[A-Za-z_$]/m.test(code)) return null;
      const result = await transform(code, {
        loader: 'ts',
        target: 'es2022',
        sourcefile: id,
        sourcemap: true,
        tsconfigRaw: {
          compilerOptions: { experimentalDecorators: false, useDefineForClassFields: true },
        },
      });
      return { code: result.code, map: result.map };
    },
  };
}

/** Benchmarks run separately: they are slow and are not a correctness gate. */
export default defineConfig({
  plugins: [decorators()],
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
