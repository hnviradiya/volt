# Reactivity API

Volt's reactive core implements the
[TC39 Signals proposal](https://github.com/tc39/proposal-signals). Everything
under `Signal` matches the proposal; everything else is Volt's layer on top.

## `Signal.State`

```ts
new Signal.State<T>(initial: T, options?: SignalOptions<T>)
```

| Member | Description |
|---|---|
| `get(): T` | Read, subscribing the enclosing computed or effect |
| `set(value: T): void` | Write. Ignored when the value compares equal |

```ts
const count = new Signal.State(0);
count.set(1);
count.get(); // 1
```

## `Signal.Computed`

```ts
new Signal.Computed<T>(fn: () => T, options?: SignalOptions<T>)
```

| Member | Description |
|---|---|
| `get(): T` | Evaluate if needed, then return the cached value |

Lazy — it runs when read, not when a dependency changes. Memoised — it
re-runs only when a dependency's value actually changed. Errors are cached
exactly like values and rethrown on each read until inputs change.

A computed may not write to a signal, and may not read itself; both throw.

## `SignalOptions`

```ts
interface SignalOptions<T> {
  equals?: (a: T, b: T) => boolean;             // default: Object.is
  [Signal.subtle.watched]?: () => void;
  [Signal.subtle.unwatched]?: () => void;
}
```

`watched` fires when the signal becomes reachable from a `Watcher`;
`unwatched` when it stops being reachable. Use them to attach and release
external resources.

## `Signal.subtle`

Lower-level operations. `subtle` marks APIs that expose graph internals or
bypass tracking.

| Member | Description |
|---|---|
| `untrack(cb)` | Run `cb` without subscribing to what it reads |
| `currentComputed()` | The computed currently evaluating, or `null` |
| `introspectSources(node)` | What a computed or watcher reads |
| `introspectSinks(node)` | What reads a signal |
| `hasSinks(node)` / `hasSources(node)` | Connectivity checks |
| `Watcher` | Low-level change notification |
| `watched` / `unwatched` | Option symbols |

### `Signal.subtle.Watcher`

```ts
const w = new Signal.subtle.Watcher(() => { /* schedule work */ });
w.watch(someComputed);
w.getPending();  // watched signals that are out of date
w.watch();       // re-arm after draining
w.unwatch(someComputed);
```

The notify callback fires **synchronously during `.set()`**, after the graph
is coloured. Reading or writing signals inside it is forbidden — schedule
instead. It fires at most once until re-armed with `watch()`.

## Effects

| Function | Description |
|---|---|
| `effect(fn)` | Runs immediately, re-runs on change, after the DOM settles |
| `renderEffect(fn)` | Same, but flushes before user effects. For DOM patching |

Both return a disposer. Returning a function from `fn` registers a cleanup
that runs before the next execution and on disposal.

```ts
const stop = effect(() => {
  const id = setInterval(tick, delay.get());
  return () => clearInterval(id);
});
```

## Scheduling

| Function | Description |
|---|---|
| `flushSync()` | Drain pending effects now |
| `tick()` | Promise resolving once the DOM reflects all pending changes |
| `batch(fn)` | Group writes so nothing flushes until `fn` returns |

Updates coalesce onto a microtask by default.

## Scopes

| Function | Description |
|---|---|
| `createRoot(fn)` | Run `fn` in a fresh scope; receives a disposer |
| `onCleanup(fn)` | Register a cleanup on the current scope |
| `getScope()` | The current scope, or `null` |
| `runWithScope(scope, fn)` | Run `fn` with `scope` current |
| `disposeScope(scope)` | Dispose a scope and everything it owns |

Disposing a scope disposes its child scopes, stops its effects, and runs
cleanups newest-first.

## Context

| Function | Description |
|---|---|
| `createContext(defaultValue, name?)` | Create a context key |
| `provideContext(context, value)` | Provide a value on the current scope |
| `useContext(context)` | Resolve from the nearest provider, else the default |

## Type guards

| Function | Description |
|---|---|
| `isSignal(v)` | True for `Signal.State` or `Signal.Computed` |
| `isWritableSignal(v)` | True for `Signal.State` |
