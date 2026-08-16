# @voltdev/vite-plugin

The Vite plugin. Required for a Volt application, not optional.

```bash
pnpm add -D @voltdev/vite-plugin@alpha vite
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { volt } from '@voltdev/vite-plugin';

export default defineConfig({
  plugins: [volt()],
  build: { target: 'esnext' },
});
```

It does two things nothing else in the toolchain currently does:

1. **Lowers TC39 standard decorators.** They are stage 3 and implemented by no
   JavaScript engine. Vite transforms with oxc, which parses decorators but
   emits them untouched — so `@Component` would reach the browser as a syntax
   error.
2. **Compiles templates at build time**, so the compiler never ships and no
   template is parsed at runtime.

It also compiles `styleUrl` through Sass, and rejects a `templateUrl` whose
spelling differs from the file on disk — including case, which otherwise
resolves on macOS and breaks the first Linux CI run.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev](https://voltjs.dev)
