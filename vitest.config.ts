import { defineConfig, type Plugin } from 'vitest/config';
import { resolve } from 'node:path';
import { transform } from 'esbuild';

const root = import.meta.dirname;

/**
 * Lower TC39 standard decorators.
 *
 * Vite 8 transforms with oxc, which parses decorators but emits them
 * untouched — and no engine implements them, so they fail at runtime. esbuild
 * is the transform that actually lowers them.
 *
 * This is deliberately inlined rather than imported from
 * `@voltjs/vite-plugin`: config files load before the plugin's own source can
 * be resolved. The published plugin does exactly this, and is covered by
 * `packages/vite-plugin/test`.
 */
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
          compilerOptions: {
            experimentalDecorators: false,
            useDefineForClassFields: true,
          },
        },
      });

      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  plugins: [decorators()],
  // Tests assert on the developer diagnostics, so they run with them on. In a
  // production build @voltjs/vite-plugin defines this as false and the
  // minifier removes every guarded block.
  define: { __VOLT_DEV__: 'true' },
  resolve: {
    alias: {
      '@voltjs/reactivity': resolve(root, 'packages/reactivity/src/index.ts'),
      '@voltjs/compiler': resolve(root, 'packages/compiler/src/index.ts'),
      // Longest first — '@voltjs/core' would otherwise shadow its subpaths.
      '@voltjs/core/runtime': resolve(root, 'packages/core/src/runtime.ts'),
      '@voltjs/core/jit': resolve(root, 'packages/core/src/jit.ts'),
      '@voltjs/core': resolve(root, 'packages/core/src/index.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['packages/*/test/**/*.test.ts'],
    // Benchmarks are opt-in: `pnpm bench`.
    exclude: ['**/node_modules/**', 'benchmarks/**'],
    globals: false,
  },
});
