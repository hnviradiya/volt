# Introduction

Volt takes three ideas that are usually found apart and puts them together.

## Components are classes

A Volt component is a class with a decorator, in the shape Angular
popularised: state as fields, behaviour as methods, a template alongside.

```ts
@Component({
  selector: 'v-greeting',
  templateUrl: './greeting.html',
})
export class Greeting {
  name = new Signal.State('world');
}
```

```html
<!-- greeting.html -->
<p>Hello, { name.get() }.</p>
```

The decorators are **TC39 standard decorators**, not the legacy experimental
ones. There is no `reflect-metadata`, no `experimentalDecorators: true`, and
no dependency-injection container. A component is a class you can construct
in a test with `new`.

## Templates say what they mean

Everything dynamic in a Volt template starts with `:`. Structure, events, and
bindings all share the prefix, and the name decides which one you get.

```html
<button :click="save()" :disabled="busy.get()" :class="{ pending: busy.get() }">
  Save
</button>
```

That is the whole rule. There is no separate sigil to remember for events and
another for bindings.

## Reactivity is the standard

Volt's reactive core is an implementation of the
[TC39 Signals proposal](https://github.com/tc39/proposal-signals) — the same
`Signal.State` / `Signal.Computed` / `Signal.subtle.Watcher` API that is
working its way toward the language.

```ts
const count = new Signal.State(0);
const doubled = new Signal.Computed(() => count.get() * 2);

count.set(21);
doubled.get(); // 42
```

Computeds are lazy: they re-evaluate when read, not when a dependency
changes. Diamonds are glitch-free: a value that depends on two paths from the
same source evaluates once per change, never against a half-updated graph.

The proposal deliberately ships **no** `effect`, because scheduling is a
framework concern. Volt supplies exactly that layer — and nothing else — on
top of `Signal.subtle.Watcher`.

## No virtual DOM

This is the part that ties the other three together.

When `count.set(1)` runs in a React-shaped framework, the component function
re-runs, produces a new tree, and the framework diffs it against the old one.
Volt does none of that. The template compiles to code that clones static
markup once and wires **one effect per dynamic binding**:

```js
const _tmpl0 = _rt.template("<p>Hello, <!>.</p>");

function render(_ctx) {
  const _el1 = _tmpl0();
  _rt.bindText(_el1, () => "Hello, " + _rt.toDisplayString(_ctx.name.get()) + ".");
  return _el1;
}
```

Changing `name` re-runs that one binding. The component class is not touched.
Its methods do not run. Nothing is diffed.

## What the compiler removes

Because the template is analysed at build time, work that a runtime would
repeat is done once, or not at all:

- **Static subtrees** are baked into the cloned markup and never visited again
- **Identical markup** across templates shares one hoisted `<template>`
- **Constant bindings** are folded into the markup and emit no effect —
  `:class="'btn'"` becomes `class="btn"` in the HTML
- **Text-only elements** compile to a single text binding rather than one
  marker per interpolation
- **Node references** are resolved to `firstChild`/`nextSibling` chains
  computed at build time, reusing earlier references where possible

Expressions are parsed to a real AST, not rewritten with patterns, which is
what makes the constant folding provably safe and the identifier resolution
scope-aware.

## What Volt is not

- **Not a re-render framework.** There is no component-level update.
- **Not a DI framework.** Share state with imports or with scoped context.
- **Not backwards compatible.** Volt targets current engines only. No legacy
  decorators, no downlevelled output, no polyfills for old browsers.

Next: [Getting started](./getting-started).
