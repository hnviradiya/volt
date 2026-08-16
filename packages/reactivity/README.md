# @voltdev/reactivity

The [TC39 Signals proposal](https://github.com/tc39/proposal-signals),
implemented. `Signal.State`, `Signal.Computed`, and the `Signal.subtle`
namespace, with the graph colouring and glitch-free evaluation the proposal
describes.

Usable on its own — it has no dependencies and knows nothing about the DOM.

```bash
pnpm add @voltdev/reactivity@alpha
```

```ts
import { Signal, effect } from '@voltdev/reactivity';

const count = new Signal.State(0);
const doubled = new Signal.Computed(() => count.get() * 2);

effect(() => console.log(doubled.get()));   // 0
count.set(21);                              // 42
```

A computed re-runs only when something it read actually changed, and only
once per flush no matter how many of its sources moved. An effect that reads
nothing is never woken.

> **Pre-alpha.** Published under the `alpha` tag; the API is still moving.

Documentation: [voltjs.dev](https://voltjs.dev)
