# Templates

A Volt template is HTML. The only addition is that everything dynamic starts
with `:`.

```html
<article class="card" :class="{ featured: isFeatured.get() }">
  <h2>{{ title.get() }}</h2>
  <p :if="summary.get()">{{ summary.get() }}</p>
  <button :click="open()">Read more</button>
</article>
```

For the complete list of directives and how a `:name` is resolved, see the
[template syntax reference](../reference/template-syntax).

## Expressions

Template expressions are real JavaScript, parsed to an AST rather than
pattern-matched. That is what makes identifier resolution reliable:

- **Free identifiers** resolve to the component instance — `count` becomes
  `_ctx.count`
- **Loop bindings** and arrow parameters stay local and are never rewritten
- **A fixed set of globals** — `Math`, `JSON`, `Date`, `Object`, `console`,
  `window`, `document`, and friends — resolve to the global scope

```html
<!-- `item` is local, `Math` is global, `rate` is on the component -->
<li :for="item in items.get()">
  {{ Math.round(item.value * rate.get()) }}
</li>
```

Anything not in the globals list becomes a component property access, which
fails loudly rather than silently reading a global.

## Reading signals

Templates read signals the same way your code does — with `.get()`:

```html
<p>{{ count.get() }}</p>
```

There is no hidden auto-unwrapping. What you write is what runs, which means
a template expression behaves identically if you paste it into a method.

The one exception is `:for` bindings, which are accessors under the hood so
that keyed rows can update in place. The compiler adds the call for you, so
you write <code v-pre>{{ item.name }}</code>, not <code v-pre>{{ item().name }}</code>.

## Statements vs. references in handlers

```html
<button :click="handler">…</button>        <!-- a reference: used as-is -->
<button :click="() => save(1)">…</button>  <!-- a function: used as-is -->
<button :click="save(1)">…</button>        <!-- a statement: wrapped -->
```

An expression that is a bare identifier, a member access, or an arrow
function is treated as the handler itself. Anything else is wrapped in a
function so it runs on each event, with `$event` in scope.

## Multiple roots

A template may have several root nodes:

```html
<h1>{{ title.get() }}</h1>
<p>{{ body.get() }}</p>
```

## What the compiler does with your template

Three things are worth knowing, because they change what you should optimise
for:

**Static markup costs nothing at runtime.** A subtree with no bindings is
parsed once into a `<template>` and cloned per instance. Deeply nested static
markup is effectively free — don't contort a template to avoid it.

**Constant bindings disappear.** `:class="'btn'"`, `:disabled="true"`, and
<code v-pre>{{ 2 + 3 }}</code> are evaluated at build time and folded into the
markup. They
emit no effect.

**Text-only elements get one binding.**
<code v-pre>&lt;p&gt;Hi, {{ a.get() }} and {{ b.get() }}&lt;/p&gt;</code>
compiles to a single text binding over one text node, not two insertion
points with markers.

What is left is one effect per binding that can actually change. See
[how the compiler works](./compiler) for the details.
