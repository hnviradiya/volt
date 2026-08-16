# @voltdev/compiler

Compiles Volt templates to DOM instructions. No virtual DOM is produced and
none is needed at runtime: static markup becomes a hoisted `<template>` that
is cloned, and every dynamic position is reached by a `firstChild` /
`nextSibling` path worked out at build time.

Normally you do not call this — [`@voltdev/vite-plugin`](https://www.npmjs.com/package/@voltdev/vite-plugin)
runs it over your components during the build.

```bash
pnpm add -D @voltdev/compiler@alpha
```

```ts
import { compile } from '@voltdev/compiler';

const { code, stats } = compile('<p>Hello, { name.get() }.</p>');
```

What it does before emitting anything: folds constant bindings away, dedupes
identical markup between components, and reports which event handlers it could
delegate. `stats` says what it removed.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev](https://voltjs.dev)
