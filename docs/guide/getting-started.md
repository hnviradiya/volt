# Getting started

## Requirements

Volt targets current engines and carries no legacy support. You need **Node
22+** and **pnpm 10+**.

## Install

```bash
pnpm add @voltjs/core
pnpm add -D @voltjs/vite-plugin vite
```

## Configure Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { volt } from '@voltjs/vite-plugin';

export default defineConfig({
  plugins: [volt()],
  build: { target: 'esnext' },
});
```

The plugin is **required**, not a convenience. It does two things nothing
else in the toolchain currently does:

1. **Lowers TC39 standard decorators.** They are stage 3 and implemented by
   no JavaScript engine. Vite 8 transforms with oxc, which parses decorators
   but emits them untouched, so `@Component` would reach the browser as a
   syntax error.
2. **Compiles templates at build time**, so the compiler never ships to the
   browser and no template is parsed at runtime.

::: tip No build step?
Import `@voltjs/core/jit` once at startup to compile templates in the browser
instead. Convenient for prototypes and playgrounds — but it ships the
compiler, so prefer the plugin for anything real.
:::

## TypeScript configuration

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable", "ESNext.Decorators"],
    "strict": true,
    "useDefineForClassFields": true,
    "experimentalDecorators": false
  }
}
```

`experimentalDecorators` must be **off**. Volt uses standard decorators; the
legacy transform is a different feature with different semantics and is not
supported.

## Your first component

```ts
// src/counter.ts
import { Component, Signal } from '@voltjs/core';

@Component({
  selector: 'v-counter',
  template: `
    <div class="counter">
      <button :click="decrement()">−</button>
      <output>{{ count.get() }}</output>
      <button :click="increment()">+</button>
    </div>
  `,
  styles: `
    .counter { display: flex; gap: 0.5rem; align-items: center; }
  `,
})
export class Counter {
  count = new Signal.State(0);

  increment() {
    this.count.set(this.count.get() + 1);
  }

  decrement() {
    this.count.set(this.count.get() - 1);
  }
}
```

## Mount it

```ts
// src/main.ts
import { mount } from '@voltjs/core';
import { Counter } from './counter.js';

mount(Counter, '#app');
```

```html
<!-- index.html -->
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
```

`mount` returns a handle:

```ts
const app = mount(Counter, '#app');

app.instance;   // the component instance
app.unmount();  // disposes every effect it created, then clears the host
```

## Using one component from another

A template may only reference components listed in its `imports`. This keeps
resolution explicit and lets bundlers see the dependency.

```ts
@Component({
  selector: 'v-app',
  imports: [Counter],
  template: `
    <main>
      <h1>Counters</h1>
      <v-counter></v-counter>
    </main>
  `,
})
export class App {}
```

Alternatively, register a component once and use it anywhere:

```ts
import { registerComponent } from '@voltjs/core';
registerComponent(Counter);
```

## Next

- [Components](./components) — inputs, outputs, lifecycle
- [Reactivity](./reactivity) — signals, computeds, effects
- [Templates](./templates) — the `:` syntax in full
