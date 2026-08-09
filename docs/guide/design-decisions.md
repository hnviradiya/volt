# Design decisions

Notes on why Volt is shaped the way it is, including the trade-offs.

## Everything dynamic starts with `:`

Vue uses three sigils: `v-` for directives, `:` for bindings, `@` for events.
Volt uses one and resolves the meaning from the name.

The cost is that resolution has to be defined precisely, because `:click` and
`:value` look identical but do different things. The order is fixed:
structural directives, then explicit escapes (`:on-*`, `:prop-*`, `:attr-*`),
then `:class`/`:style`, then known DOM event names, then property bindings.

The escapes exist so the ambiguous cases are always expressible. A component
output is `:on-changed`, never a bare `:changed` — because `changed` is not a
DOM event and would otherwise be read as a property.

## Reactivity is the TC39 proposal, not an interpretation of it

Volt could have shipped a smaller, more ergonomic signal API — callable
signals, `count()` instead of `count.get()`. It ships the standard instead.

The benefit is that what you learn transfers, the semantics are specified
rather than invented, and code is portable to any other implementation. The
cost is verbosity: `count.get()` in every template expression.

That verbosity is deliberate. Templates read signals exactly the way your
methods do, so an expression behaves identically whether it sits in a
template or a method body — no hidden auto-unwrapping to reason about.

## No dependency injection

Angular's DI is the piece Volt deliberately leaves out. Sharing state through
a module import is simpler, statically analysable, and needs no container,
tokens, or lifetime rules:

```ts
export const user = new Signal.State<User | null>(null);
```

Because signals track precisely, only components that actually read `user`
update when it changes. There is no provider to re-render, which removes most
of the reason frameworks need DI for state.

Scoped context exists for the cases where a value genuinely belongs to a
subtree, but it is scope lookup, not injection.

## Standard decorators only

Legacy decorators need `experimentalDecorators`, and parameter decorators
need `reflect-metadata`. Both are on the way out. Volt supports only the
stage-3 standard.

The practical cost is real: **no engine implements standard decorators yet**,
and Vite 8's oxc transformer parses but does not lower them. TypeScript 7 is
the native Go port and exposes no JavaScript transform API. So the Vite
plugin does the lowering with esbuild, and is not optional.

`Symbol.metadata` is likewise absent from every current engine; Volt installs
it before any decorated class is evaluated.

## Updates are asynchronous

Writes coalesce onto a microtask, so a burst of `.set()` calls repaints once.

This follows from the proposal's design: a `Watcher`'s notify callback fires
synchronously during `.set()`, but reading or writing signals inside it is
forbidden — the graph is mid-colouring. Flushing therefore has to be
scheduled.

`flushSync()` and `await tick()` exist for tests and measurement.

## No virtual DOM, and no component re-render

The component class runs once. This is the constraint everything else is
built around, and it is why the compiler matters so much: with no diff to
fall back on, the compiler has to know exactly which nodes each expression
can affect.

The trade-off is that Volt cannot support patterns that assume re-execution.
There is no equivalent of calling a component function again to get a fresh
tree. State lives in signals, and the DOM follows from them.

## `:for` keys by identity, not position

Every framework has to pick what a row's identity is when no key is given,
and both obvious answers are traps. Keying by **position** is cheap but wrong
on reorder: the text updates correctly while focus, input values and
animations stay behind on the wrong row. Keying by **object identity** is
correct on reorder but rebuilds the whole list when data is refetched as
equal-but-new objects.

Vue, Svelte and React all default to position. Angular 17 concluded there was
no safe default and made `track` mandatory. Solid removed the choice by
keying `<For>` on identity always, with `<Index>` as the separate positional
primitive.

Volt follows Solid: identity by default, because the reorder bug is silent
and the refetch cost is not. `:key="item.id"` handles replacement, and
`:key="$index"` asks for positional explicitly. No mandatory parameter, and
the default is the one whose failure mode is visible.

## Keyed rows are updated, not rebuilt

A `:for` row whose key survives is never re-created — its item and index
signals are updated in place. That is what makes reordering move existing
elements.

It also means a destructuring binding has to become per-field accessors
rather than a snapshot, so `{ id, text }` stays reactive. The compiler
generates those accessors; you write ordinary destructuring.

## Bubbling events are delegated

A handler per element is the obvious implementation and the wrong one at
scale: ten thousand rows with two handlers each means twenty thousand
listeners to register on create and unregister on remove.

Volt installs one listener per event type on the document and walks up from
the target, storing each handler on its node. Creating and destroying rows
becomes a property assignment rather than a registry mutation.

The cost is that the synthetic walk has to reproduce what the real capture
and bubble phases would have done. `currentTarget` is null during a
document-level dispatch, so Volt sets it to the node whose handler is
running; `stopPropagation` is intercepted so it ends the walk rather than
only the native phase. Events that do not bubble, and any handler needing
`.capture`, `.once` or `.passive`, get a real listener instead — delegation
cannot express those.

## Markers only where they are needed

Dynamic content needs an anchor so the runtime knows where to insert. A naive
implementation puts a comment marker at every hole, which shows up in the
DOM and costs a node each.

Volt avoids them in the common cases: an element whose children are all text
compiles to one text binding with no marker, and a block whose only root is
dynamic returns the accessor directly rather than wrapping it. Markers remain
only where structure genuinely requires one.
