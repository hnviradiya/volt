# Components

A component is a class. It is constructed once per mounted instance and never
re-run to produce a view.

```ts
import { Component, Signal } from '@voltjs/core';

@Component({
  selector: 'v-greeting',
  template: `<p>Hello, {{ name.get() }}.</p>`,
})
export class Greeting {
  name = new Signal.State('world');
}
```

## Configuration

| Option | Meaning |
|---|---|
| `selector` | The tag this component answers to. Required. |
| `template` | Template source, compiled on first use |
| `render` | A pre-compiled render function (the Vite plugin fills this in) |
| `styles` | CSS injected once per component |
| `imports` | Components this template may reference |

## Inputs

`@Input()` declares a property the parent can bind to. Which form you choose
decides whether the child reacts to changes:

```ts
export class Counter {
  // Reactive: a parent write flows in through .set()
  @Input() step = new Signal.State(1);

  // Reactive: signal-backed automatically, read as a plain property
  @Input() accessor label = 'Counter';

  // Not reactive: plain assignment, fine for values that never change
  @Input() id = '';
}
```

```html
<v-counter :step="stepSize.get()" :label="'Total'"></v-counter>
```

When the parent's binding is an expression, Volt keeps it live — the child
sees each new value without either component re-rendering.

Rename or require an input:

```ts
@Input({ alias: 'for', required: true }) target = new Signal.State('');
```

A missing required input throws at construction.

## Outputs

`@Output()` declares an event the parent can listen to with `:on-*`:

```ts
import { EventEmitter, Output } from '@voltjs/core';

export class Counter {
  @Output() changed = new EventEmitter<number>();

  increment() {
    this.count.set(this.count.get() + 1);
    this.changed.emit(this.count.get());
  }
}
```

```html
<v-counter :on-changed="onCount($event)"></v-counter>
```

Subscriptions are released when the parent is disposed. A field with no
initialiser gets an `EventEmitter` automatically.

## Lifecycle

```ts
import { type OnInit, type OnMount, type OnDestroy } from '@voltjs/core';

export class Panel implements OnInit, OnMount, OnDestroy {
  onInit() {
    // Inputs are applied; the template has not been built yet, so writes
    // here are visible in the first paint.
  }

  onMount() {
    // The DOM is in the document — safe to measure or focus.
  }

  onDestroy() {
    // The component is being torn down.
  }
}
```

Effects created during `onInit` are owned by the component and disposed with
it, so most cleanup needs no `onDestroy` at all.

## Composition

A template may reference components listed in its `imports`:

```ts
@Component({
  selector: 'v-app',
  imports: [Counter, Todos],
  template: `
    <main>
      <v-counter :step="2"></v-counter>
      <v-todos></v-todos>
    </main>
  `,
})
export class App {}
```

Or register globally, once:

```ts
import { registerComponent } from '@voltjs/core';
registerComponent(Counter);
```

A hyphenated tag that resolves to no component is treated as a real custom
element, so web components work without registration.

## Sharing state

Volt has **no dependency injection**. Share state the way plain TypeScript
does — with a module:

```ts
// store.ts
import { Signal } from '@voltjs/core';

export const user = new Signal.State<User | null>(null);
export const isSignedIn = new Signal.Computed(() => user.get() !== null);
```

```ts
import { user } from './store.js';

@Component({ selector: 'v-header', template: `<p>{{ user.get()?.name }}</p>` })
export class Header {
  user = user;
}
```

When state should be scoped to a subtree rather than global, use context:

```ts
import { createContext, provideContext, useContext } from '@voltjs/core';

const Theme = createContext<'light' | 'dark'>('light');

export class Shell {
  onInit() {
    provideContext(Theme, 'dark');
  }
}

export class Button {
  theme = useContext(Theme); // resolved from the nearest provider
}
```

This is scope lookup, not injection: there is no container, no token
registry, and no lifetime management.

## Testing

A component is a class, so unit tests need no framework:

```ts
const counter = new Counter();
counter.increment();
expect(counter.count.get()).toBe(1);
```

For DOM behaviour, mount and flush:

```ts
import { flushSync, mount } from '@voltjs/core';
import '@voltjs/core/jit';

const app = mount(Counter, host);
host.querySelector('button')!.click();
flushSync();
expect(host.textContent).toContain('1');
app.unmount();
```
