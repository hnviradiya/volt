# Component API

## `@Component(config)`

```ts
interface ComponentConfig {
  selector: string;
  templateUrl?: string;
  render?: (ctx: unknown) => unknown;
  styleUrl?: string;
  styleUrls?: string[];
  styles?: string | string[];
  imports?: ComponentType[];
}
```

| Option | Description |
|---|---|
| `selector` | Tag this component answers to. Required |
| `templateUrl` | Path to an `.html` file, relative to this file |
| `render` | Pre-compiled render function; the Vite plugin fills this in |
| `styleUrl` / `styleUrls` | Path(s) to `.scss` files, relative to this file |
| `styles` | Compiled CSS, filled in by the plugin from `styleUrl` |
| `imports` | Components this template may reference |

`templateUrl`, `styleUrl` and `styleUrls` are resolved **at build time** by
`@voltjs/vite-plugin`, which also registers each file with the watcher so
edits hot-reload. Without the plugin they cannot be resolved — the browser has
no filesystem — and Volt throws with a message saying so.

Applied to a class. Runs after every member decorator, so the input and
output metadata it reads is complete.

## `@Prop(options?)`

```ts
interface PropOptions {
  alias?: string;    // template-facing name
  required?: boolean;
}
```

Two forms, differing in reactivity:

```ts
@Prop() a = new Signal.State(0);  // parent writes call .set() — reactive
@Prop() b = 0;                    // plain assignment — not reactive
```

A prop is reactive because it holds a signal, never because the decorator
rewrote the property. `@Prop() accessor` is rejected for that reason: it would
make `{{ b }}` a tracked read while looking like a plain field.

A missing required prop throws at construction.

An **undeclared** prop throws too. Volt has no fall-through for unrecognised
attributes, so a name matching no prop can only be a mistake — most often a
kebab-cased spelling of a camelCase prop:

```
[volt] <v-counter> has no prop "max-count". Did you mean "maxCount"?
Declared props: maxCount, onChanged.
```

There is one spelling: the declared one. Cannot be applied to static
or symbol-named members.

## Notifying the parent

A component notifies its parent by calling a function the parent gave it:

```ts
@Prop() onChanged?: (value: number) => void;

// somewhere in the class
this.onChanged?.(next);
```

```html
<v-counter :onChanged="handle"></v-counter>
```

A prop matching `on[A-Z]` given a bare method reference is bound to the
component that declared it, so `this` is correct without an arrow.

`:on-*` is the syntax for real DOM and custom-element events. Applying it to a
Volt component throws, naming the callback prop to use instead.

## Lifecycle

```ts
interface OnMount { onMount(): void }
```

| | when |
|---|---|
| field initializers | at construction — computeds are lazy and effects are deferred, so both see props |
| `onMount` | after the component's DOM is in the document |
| `onCleanup(fn)` | registered anywhere in the component; runs on teardown |

Setup belongs in field initializers: a `Signal.Computed` reads props lazily,
and an `effect` has its first run deferred until after props are applied, so
both see the values the parent passed. Teardown belongs in `onCleanup`,
written beside the setup it undoes.

`onMount` exists for the one thing neither can do — touching DOM that is
already in the document, for focus, measurement, or handing an element to a
library.

`mount()` flushes before returning, so the tree it hands back already
reflects any field effects.

## `mount(component, target)`

```ts
const app = mount(App, '#app');       // selector or Element

app.instance;   // the component instance
app.unmount();  // dispose every effect, then clear the host
```

## `compileTemplate(source, filename?)`

From `@voltjs/core/jit`. Compiles template source into a render function at
runtime, for tests and playgrounds:

```ts
import { compileTemplate } from '@voltjs/core/jit';

@Component({
  selector: 'v-greeting',
  render: compileTemplate(`<p>Hello, {{ name.get() }}.</p>`),
})
export class Greeting {}
```

Importing this entry pulls the compiler into the bundle. Production
components use `templateUrl`, which needs none of it at runtime.

## Runtime helpers

`createComponent` and `slot` are called by compiled templates. You should not
need them directly.

## Lazy components

Fetch a component on first use so it lands in its own chunk.

```ts
import { lazy } from '@voltjs/core';

const Chart = lazy('v-chart', () => import('./chart.js'), {
  fallback: () => 'Loading…',
  error: (err, retry) => `Could not load. ${err}`,
});

@Component({ selector: 'v-page', imports: [Chart], templateUrl: './page.html' })
export class Page {}
```

It goes in `imports` and is written in a template exactly like any other
component. The selector is given to `lazy()` rather than read from the
component, because a template mentioning `<v-chart>` has to resolve it before
the chunk that defines it exists.

The loader may return the module (`import('./chart.js')`) or the class itself.
It runs once however many instances are rendered.

`preload(Chart)` starts the fetch without rendering — what a router calls on
hover or on route match, so the chunk has arrived by the time the view mounts.

Supplying `error` is worth the trouble. The usual cause of a failed chunk in
production is a deploy that removed the file a still-open tab is asking for,
and that case recovers on retry.
