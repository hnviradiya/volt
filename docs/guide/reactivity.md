# Reactivity

Volt's reactive core is an implementation of the
[TC39 Signals proposal](https://github.com/tc39/proposal-signals). The API
you use is the proposal's API — not a wrapper, not a lookalike.

## State

```ts
import { Signal } from '@volt/core';

const count = new Signal.State(0);

count.get();   // 0
count.set(1);
count.get();   // 1
```

Writes that compare equal are ignored, so nothing downstream re-runs:

```ts
const point = new Signal.State({ x: 0 }, { equals: (a, b) => a.x === b.x });
point.set({ x: 0 }); // no change propagates
```

The default comparison is `Object.is`.

## Computed

```ts
const doubled = new Signal.Computed(() => count.get() * 2);
doubled.get(); // 2
```

Computeds have two properties worth internalising.

**They are lazy.** A computed does not run when a dependency changes — it
runs when someone reads it. A computed nothing reads never executes.

```ts
const expensive = new Signal.Computed(() => {
  console.log('running');
  return count.get() * 2;
});
// nothing logged yet

count.set(5);
// still nothing logged

expensive.get(); // logs 'running'
```

**They are glitch-free.** A value reachable by two paths from the same source
evaluates once per change, and never sees a half-updated graph:

```ts
const source = new Signal.State(1);
const left   = new Signal.Computed(() => source.get() * 2);
const right  = new Signal.Computed(() => source.get() * 3);
const total  = new Signal.Computed(() => left.get() + right.get());

source.set(2);
total.get(); // 10 — `total` re-ran once, not once per path
```

A computed whose own value did not change also stops propagation:

```ts
const isEven = new Signal.Computed(() => source.get() % 2 === 0);
const label  = new Signal.Computed(() => (isEven.get() ? 'even' : 'odd'));

source.set(4); // 2 -> 4: `isEven` is still true, so `label` does not re-run
```

Dependencies are tracked dynamically, so a branch not taken is not a
dependency:

```ts
const useA = new Signal.State(true);
const value = new Signal.Computed(() => (useA.get() ? a.get() : b.get()));
// while `useA` is true, writing to `b` does not invalidate `value`
```

## Effects

The proposal deliberately ships no `effect`, because scheduling ties into a
framework's rendering cycle. Volt provides it, built on
`Signal.subtle.Watcher`.

```ts
import { effect, createRoot } from '@volt/core';

createRoot((dispose) => {
  effect(() => {
    console.log('count is', count.get());
  });

  return dispose;
});
```

An effect's first run is **deferred to the next flush**, not performed at
creation. That is what lets an effect declared in a class field observe values
assigned to the instance afterwards — component props, most importantly —
rather than firing once against the field's initial value.

```ts
createRoot(() => {
  effect(() => console.log(count.get()));
});
// nothing logged yet
flushSync();
// 0
```

`renderEffect` is the exception: it runs immediately, because a template has
to produce its nodes before anything can insert them.

### Cleanup

Return a function to clean up before the next run and on disposal:

```ts
effect(() => {
  const id = setInterval(tick, delay.get());
  return () => clearInterval(id);
});
```

### Scheduling

Updates are **coalesced onto a microtask**. A burst of writes repaints once:

```ts
count.set(1);
count.set(2);
count.set(3);
// the effect runs once, seeing 3
```

When you need the DOM up to date on the current turn — tests, measurement —
flush explicitly:

```ts
import { flushSync, tick } from '@volt/core';

count.set(1);
flushSync();        // synchronous
await tick();       // or await the microtask
```

### Render effects run first

Volt schedules in two phases. `renderEffect` patches the DOM; `effect` is for
your own work and runs after the DOM has settled, so it always observes a
consistent tree. Compiled templates use `renderEffect`; you almost always
want `effect`.

## Ownership and disposal

Effects belong to the scope that created them. Disposing the scope disposes
the effects, runs their cleanups, and unsubscribes everything.

```ts
import { createRoot, onCleanup } from '@volt/core';

const dispose = createRoot((dispose) => {
  effect(() => { /* ... */ });
  onCleanup(() => console.log('gone'));
  return dispose;
});

dispose(); // effect stops, cleanup runs
```

Components do this for you: `mount(...).unmount()` disposes the component's
scope, and a `:if` branch disposes the branch it leaves.

## Batching

Because updates already coalesce on a microtask, `batch` matters only
alongside `flushSync`, or when a partially-applied state would be observable:

```ts
import { batch } from '@volt/core';

batch(() => {
  firstName.set('Ada');
  lastName.set('Lovelace');
}); // nothing observes the intermediate state
```

## Untracked reads

```ts
const value = new Signal.Computed(() =>
  tracked.get() + Signal.subtle.untrack(() => hidden.get()),
);
```

`hidden` is read but not subscribed to.

## Rules

**A computed must not write to a signal.** Volt throws rather than let you
build a graph whose result depends on evaluation order:

```ts
new Signal.Computed(() => {
  other.set(1); // Error: A Signal.Computed must not write to a Signal.State
  return 0;
});
```

Effects may write freely — that is what they are for.

**A computed must not read itself.** Cycles are detected and throw.

## Introspection

`Signal.subtle` exposes the graph for tooling and tests:

```ts
Signal.subtle.introspectSources(computed); // what it reads
Signal.subtle.introspectSinks(state);      // what reads it
Signal.subtle.hasSinks(state);             // is anything observing it
Signal.subtle.currentComputed();           // what is evaluating right now
```

Signals can also react to being observed, which is how you attach and release
external resources:

```ts
const clock = new Signal.State(Date.now(), {
  [Signal.subtle.watched]:   () => start(),
  [Signal.subtle.unwatched]: () => stop(),
});
```
