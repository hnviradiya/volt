import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const r = (p: string) => resolve(import.meta.dirname, p);
const pkg = createRequire(import.meta.url)('./package.json');

/**
 * Everything this package declares as a dependency stays external.
 *
 * Bundling a dependency into a library is wrong in general, and actively
 * breaks for packages that use CommonJS internally — dart-sass calls
 * `require` at runtime, which fails once inlined into an ES module.
 */
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
].map((name) => new RegExp(`^${name}(/.*)?$`));

export default defineConfig({
  build: {
    // Volt targets current engines; nothing here is downlevelled.
    target: 'esnext',
    lib: {
      // `namespace.ts` is an entry only so that the bundle keeps it as its own
      // chunk: inlined into `index.js` its top-level call is retained by any
      // app that touches the module at all, which is the whole reason it was
      // split out. Nothing imports it by that path — `exports` does not name
      // it, and `index.js` reaches it relatively.
      entry: {
        index: r('src/index.ts'),
        signals: r('src/signals.ts'),
        namespace: r('src/namespace.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [...external, /^node:/],
    },
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
  },
});
