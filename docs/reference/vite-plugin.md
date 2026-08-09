# Vite plugin

```ts
import { defineConfig } from 'vite';
import { volt } from '@voltjs/vite-plugin';

export default defineConfig({
  plugins: [volt()],
});
```

## Why it is required

The plugin is not a convenience. It does two things nothing else in a current
Vite toolchain does.

**It lowers TC39 standard decorators.** They are stage 3 and implemented by
no JavaScript engine. Vite 8 transforms with oxc, which parses decorators but
emits them untouched, and TypeScript 7 is the native Go port with no
JavaScript transform API. Without this pass, `@Component` reaches the browser
as a syntax error. The plugin uses esbuild, which does lower them.

**It compiles templates at build time.** `template: \`…\`` inside a
`@Component` becomes a `render` function with hoisted static markup, so no
compiler ships to the browser and no template is parsed at runtime.

## Options

```ts
interface VoltPluginOptions {
  include?: RegExp;              // default: /\.m?ts$/
  exclude?: RegExp;              // default: /[\\/]node_modules[\\/]/
  precompileTemplates?: boolean; // default: true
  runtimeModule?: string;        // default: '@voltjs/core/runtime'
  debug?: boolean;               // default: false
}
```

`debug: true` logs what the compiler folded away per file:

```
[volt] src/counter.ts: 2 template(s), 3 effect(s), 4 binding(s) folded, 1 markup dedupe(s)
```

## What it will not touch

Template precompilation locates `template:` by scanning tokens, not by
matching source patterns, so it correctly ignores:

- `template:` inside a comment or a string
- `template:` in an object literal that is not a `@Component` argument
- interpolated literals — `` template: `<div>${SHARED}</div>` `` cannot be
  resolved at build time, so it is left for the runtime compiler

## Without a build step

Import `@voltjs/core/jit` once at startup to compile templates in the
browser. Useful for prototypes, playgrounds, and tests — but it ships the
compiler, so prefer the plugin for production.

```ts
import '@voltjs/core/jit';
import { mount } from '@voltjs/core';
```

A component with a `template` and no compiler available throws with a message
pointing at both options.
