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

Three forms, differing in reactivity:

```ts
@Prop() a = new Signal.State(0);  // parent writes call .set() — reactive
@Prop() accessor b = 0;           // signal-backed automatically — reactive
@Prop() c = 0;                    // plain assignment — not reactive
```

A missing required input throws at construction. Cannot be applied to static
or symbol-named members.

## Notifying the parent

There is no `@Output` and no `EventEmitter`. A component notifies its parent
through a callback passed in as an input:

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

`:on-*` remains the syntax for real DOM and custom-element events. Applying
it to a Volt component throws, naming the callback prop to use instead.

## Lifecycle

```ts
interface OnMount { onMount(): void }
```

| | when |
|---|---|
| field initializers | at construction — computeds are lazy and effects are deferred, so both see props |
| `onMount` | after the component's DOM is in the document |
| `onCleanup(fn)` | registered anywhere in the component; runs on teardown |

There is no `onInit`: a `Signal.Computed` field reads props lazily, and an
`effect` field has its first run deferred until after props are applied.
There is no `onDestroy`: `onCleanup` does the same job beside the setup it
undoes.

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
