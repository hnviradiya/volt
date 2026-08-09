# Component API

## `@Component(config)`

```ts
interface ComponentConfig {
  selector: string;
  template?: string;
  render?: (ctx: unknown) => unknown;
  styles?: string | string[];
  imports?: ComponentType[];
}
```

| Option | Description |
|---|---|
| `selector` | Tag this component answers to. Required |
| `template` | Template source, compiled on first use |
| `render` | Pre-compiled render function; the Vite plugin fills this in |
| `styles` | CSS injected once per component |
| `imports` | Components this template may reference |

Applied to a class. Runs after every member decorator, so the input and
output metadata it reads is complete.

## `@Input(options?)`

```ts
interface InputOptions {
  alias?: string;    // template-facing name
  required?: boolean;
}
```

Three forms, differing in reactivity:

```ts
@Input() a = new Signal.State(0);  // parent writes call .set() — reactive
@Input() accessor b = 0;           // signal-backed automatically — reactive
@Input() c = 0;                    // plain assignment — not reactive
```

A missing required input throws at construction. Cannot be applied to static
or symbol-named members.

## `@Output(alias?)`

Declares an event the parent listens to with `:on-*`. A field with no
initialiser is given an `EventEmitter` automatically.

```ts
@Output() changed = new EventEmitter<number>();
@Output('done') finished = new EventEmitter<void>();
```

## `EventEmitter<T>`

| Member | Description |
|---|---|
| `emit(value: T)` | Notify all listeners |
| `subscribe(fn)` | Listen; returns an unsubscribe function |
| `clear()` | Remove all listeners |

Parent subscriptions are released automatically when the parent is disposed.

## Lifecycle

```ts
interface OnInit    { onInit(): void }
interface OnMount   { onMount(): void }
interface OnDestroy { onDestroy(): void }
```

| Hook | When |
|---|---|
| `onInit` | Inputs applied, before the template is built |
| `onMount` | After the DOM is in the document |
| `onDestroy` | When the component is torn down |

Writes in `onInit` are visible in the first paint.

## `mount(component, target)`

```ts
const app = mount(App, '#app');       // selector or Element

app.instance;   // the component instance
app.unmount();  // dispose every effect, then clear the host
```

## `registerComponent(component)`

Register a component globally so any template can use it without listing it
in `imports`.

## `setTemplateCompiler(fn)`

Install a compiler for runtime template compilation. `@voltjs/core/jit` calls
this for you; the Vite plugin makes it unnecessary.

## Runtime helpers

`createComponent` and `slot` are called by compiled templates. You should not
need them directly.
