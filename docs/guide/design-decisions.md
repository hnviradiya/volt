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

## `:for` requires `:key`

Every framework has to decide what a row's identity is when no key is given,
and both obvious answers are traps. Keying by **position** is cheap but wrong
on reorder: the text updates correctly while focus, input values and
animations stay behind on the wrong row. Keying by **object identity** is
correct on reorder but rebuilds the whole list when data is refetched as
equal-but-new objects.

Vue, Svelte and React all default to position, and all three have a lint rule
or a console warning trying to undo that default. Angular 17 concluded there
was no safe default and made `track` mandatory. Solid removed the choice by
keying `<For>` on identity always, with `<Index>` as the separate positional
primitive.

Volt follows Angular: no default, and a compile error naming both remedies.
Volt's compiler already reads every template at build time, so the check
costs nothing and fires before the code runs — which is the whole reason to
have a compiler.

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

## Compared with other frameworks

What Volt took from each, and what it declined.

| | taken | declined |
|---|---|---|
| Vue | HTML templates, the ergonomics | the virtual DOM |
| Svelte | compiler-first: do it at build time or not at all | its own reactivity syntax |
| Solid | fine-grained reactivity, no component re-render | a bespoke signal implementation |
| Angular | classes, decorators, opinionated structure | dependency injection |
| Astro | islands | a separate authoring model for them |
| Qwik | lazy execution | resumability |
| TanStack | resource primitives | — (a shared query cache is planned) |
| Tailwind | design tokens | utility classes as the styling model |
| React | the component model as an idea | hooks, and the re-render that requires them |

## No proxies

A property is reactive because it holds a signal, never because something
wrapped it. That is why `@Prop() accessor` was removed, and why there is no
reactive object.

A proxy makes `obj.count++` work, at the cost of never being able to tell by
reading the code whether a property access is tracked. It also cannot see
`Map`, `Set`, class instances or anything crossing a serialization boundary
without a second implementation for each. The trade is one line of ceremony —
`.get()` — against knowing what your code does.

## No resumability

Qwik serializes the reactive graph into the HTML so the client never replays
setup. It is a real answer to a real cost in frameworks that hydrate by
re-rendering.

Volt does not hydrate by re-rendering. Codegen resolves every dynamic node by
a `firstChild`/`nextSibling` path computed at build time, so hydration is an
attach, not a reconstruction — the thing resumability avoids is already
cheap here. Buying it anyway would cost a serialization format for every
closure in the application.

## The compiler is TypeScript, not Rust

Compiling a real template takes **0.124ms**, so a thousand-component
application spends about **124ms** compiling templates — inside a build
measured in seconds. A Rust rewrite would optimise that away in exchange for
per-platform native binaries, a much higher barrier to contributing, and a
second toolchain in a project that deliberately has one.

It would also miss the part that will actually be slow. Once templates are
type-checked, the cost is TypeScript's type system, and no amount of Rust in
the parser touches that.

## No `:show`

Hiding an element is a style binding. `:class` and `:style` already express
it, and CSS is where "hidden but still in the DOM" belongs — including for a
component library, where content must stay mounted to animate out or to keep
its state.

## Animation is CSS

SwiftUI and Compose treat a transition as a value described beside the state
that drives it. It reads well. But CSS already owns transitions and
animations, runs them off the main thread, and honours
`prefers-reduced-motion` without being asked.

Volt's `createPresence` exists precisely so CSS can stay in charge: it holds a
node in the DOM until the exit animation the stylesheet declared has finished,
and asks the element whether anything is animating rather than being told a
duration. A JavaScript animation layer would duplicate all of that and lose
the off-main-thread part.

## Performance is not a setting

There is no `virtualize: false`, no `memo`, no `trackBy`, no
`shouldComponentUpdate`, no "optimization" section in any component's options.
A knob that makes an application slower is a bug with a name, and a knob that
makes it faster is a default someone forgot to set.

You choose the data and the markup. The framework chooses how to render it.

### Why that is not the same as "always virtualize"

Below roughly fifty rows, virtualization costs more than it saves: a scroll
container, a spacer, a transformed window and a `ResizeObserver`, to avoid
creating forty elements the browser would have made in under a millisecond. A
grid that virtualizes unconditionally is slower on every small grid, and small
grids are most grids.

So the rule is not one strategy always on. It is that the strategy is never
yours to pick:

| collection | what happens |
| --- | --- |
| small | render all of it; anything else is overhead |
| medium | `content-visibility: auto` with `contain-intrinsic-size` — the browser skips layout and paint for offscreen rows, at zero JavaScript cost |
| large | pool-keyed virtualization, recycling rows through a fixed window |

The threshold is the framework's business and may move as it is measured. What
does not move is that there is no option to get it wrong.

### The escapes are the framework's problem, not yours

Virtualization silently breaks things people expect to work, and every library
that ships it leaves them broken. They are correctness, not preference, so
they are handled rather than documented:

- **Printing.** A virtualized grid prints one screenful. Volt renders the full
  collection on `beforeprint` and restores the window afterwards.
- **Find in page.** `Ctrl+F` cannot match a row that is not in the DOM, which
  makes the browser's own find quietly wrong on any virtualized list anywhere.
  The grid ships a find that searches the data and scrolls the match into
  view.
- **Select all and copy.** Operates on the collection, not on the rows that
  happen to be mounted.
- **Assistive technology.** `aria-setsize` and `aria-posinset` are computed
  from the collection, so "row 4,312 of 100,000" is true even though 4,311 of
  them were never rendered.

A performance technique that breaks the page is not a performance technique.
