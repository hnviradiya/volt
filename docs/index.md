---
layout: home

hero:
  name: Volt
  text: Classes, templates, signals.
  tagline: A TypeScript UI framework with Angular-shaped components, Vue-shaped templates, and TC39 signals — and no virtual DOM anywhere.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why Volt
      link: /guide/introduction

features:
  - title: Components are classes
    details: Declared with TC39 standard decorators. A component is constructed once and never re-run to produce a view.
  - title: One prefix, one meaning
    details: Everything dynamic starts with ':' — :if, :for, :click, :class. The name alone decides what it does.
  - title: Standard signals
    details: Signal.State and Signal.Computed implemented to the TC39 proposal. Lazy, glitch-free, and standards-tracking.
  - title: The compiler does the work
    details: Static markup is cloned, constant bindings are folded away, and identical templates are shared. What is left is one effect per binding that can actually change.
---

## In one file

```ts
import { Component, Signal } from '@voltjs/core';

@Component({
  selector: 'v-counter',
  templateUrl: './counter.html',
})
export class Counter {
  count = new Signal.State(0);

  increment() { this.count.set(this.count.get() + 1); }
  decrement() { this.count.set(this.count.get() - 1); }
}
```

```html
<!-- counter.html -->
<div>
  <button :click="decrement()">−</button>
  <output>{ count.get() }</output>
  <button :click="increment()">+</button>

  <p :if="count.get() > 9">That's a lot.</p>
</div>
```

Pressing `+` updates one text node. Not the component, not a subtree — the
text node whose value changed.
