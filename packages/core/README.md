# @voltdev/core

Components, lifecycle, and the DOM runtime compiled templates call into.

```bash
pnpm add @voltdev/core@alpha
pnpm add -D @voltdev/vite-plugin@alpha vite
```

```ts
// counter.ts
import { Component, Signal } from '@voltdev/core';

@Component({
  selector: 'v-counter',
  templateUrl: './counter.html',
})
export class Counter {
  count = new Signal.State(0);
  increment() { this.count.set(this.count.get() + 1); }
}
```

```html
<!-- counter.html -->
<button :click="increment()">{ count.get() }</button>
```

A component is a class, constructed once. It never re-runs to produce a view —
each binding is its own effect, wired to the one node it owns, so changing
`count` writes to that text node and touches nothing else.

The plugin is required rather than a convenience: it lowers the TC39 decorators
(no engine implements them yet) and compiles templates at build time, so no
compiler reaches the browser.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev](https://voltjs.dev)
