import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const r = (p: string) => resolve(import.meta.dirname, p);

export default defineConfig({
  build: {
    // Volt targets current engines; nothing here is downlevelled.
    target: 'esnext',
    lib: {
      entry: { index: r('src/index.ts'), runtime: r('src/runtime.ts'), jit: r('src/jit.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      // Workspace packages and the host toolchain stay external so each
      // package ships only its own code.
      external: [/^@voltjs\//, /^node:/, 'esbuild', 'vite'],
    },
    sourcemap: true,
    minify: false,
    emptyOutDir: true,
  },
});
