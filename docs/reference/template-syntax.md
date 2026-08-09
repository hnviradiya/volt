# Template syntax

Volt has exactly one piece of dynamic syntax in markup: a `:` prefix.
Structure, events, and bindings all share it.

## How a name is resolved

`:name` is resolved in a fixed order, so a given name always means one thing:

1. **Structural directives** — `if`, `else-if`, `else`, `for`, `key`, `show`,
   `text`, `html`, `model`, `ref`, `slot`
2. **Explicit escapes** — `:on-*` (event), `:prop-*` (property), `:attr-*`
   (attribute)
3. **`:class` and `:style`**, which have their own merge semantics
4. **A known DOM event name** → an event listener
5. **Anything else** → a property or attribute binding

So `:click` is an event because `click` is a DOM event, and `:value` is a
binding because `value` is not. When in doubt — a custom event on a
component, a property that shares a name with an event — use the escape.

## Interpolation

```html
<p>Hello, {{ name.get() }}.</p>
```

Expressions are real JavaScript, parsed to an AST. Free identifiers resolve
to the component instance; loop bindings and a fixed set of globals
(`Math`, `JSON`, `Date`, `console`, …) do not.

A constant interpolation is evaluated at build time and baked into the
markup: <code v-pre>{{ 2 + 3 }}</code> compiles to the text `5` with no effect
at all.

## Structure

### `:if` / `:else-if` / `:else`

```html
<p :if="count.get() > 5">Lots</p>
<p :else-if="count.get() > 0">Some</p>
<p :else>None</p>
```

Conditions are tested in order and short-circuit; only the winning branch is
built. Leaving a branch disposes its effects and removes its DOM.

`:else-if` and `:else` must directly follow the matching element.

### `:for` and `:key`

```html
<li :for="todo in todos.get()" :key="todo.id">{{ todo.text }}</li>
```

With an index:

```html
<li :for="(todo, i) in todos.get()" :key="todo.id">{{ i }}. {{ todo.text }}</li>
```

Destructuring works, and stays reactive — each bound name becomes its own
accessor rather than a snapshot:

```html
<li :for="{ id, text } in todos.get()" :key="id">{{ text }}</li>
```

Rows are keyed. A row that survives a change is **never rebuilt** — its item
and index update in place, so only the bindings that actually read them
re-run. Reordering a list moves existing elements rather than recreating
them.

**`:key` is optional.** With no key, rows are keyed by *item identity*, so
reordering is correct by default — elements move, and whatever is attached to
them moves too.

Reach for `:key` when identity alone is not enough:

| | when to use it |
|---|---|
| *(omitted)* | the default; items keep their identity across updates |
| `:key="item.id"` | items are replaced by equal-but-new objects, e.g. after a refetch |
| `:key="$index"` | you explicitly want positional reuse |

Without a key, replacing every item with a fresh object — `items.map(i => ({...i}))`
— counts as an entirely new list and rebuilds every row. `:key="item.id"`
is what keeps the rows.

### `:show`

```html
<div :show="visible.get()">…</div>
```

Toggles `display` without removing the element. Use `:if` when the content is
expensive and often absent; use `:show` when it toggles frequently.

### `:text` and `:html`

```html
<p :text="message.get()"></p>
<article :html="rendered.get()"></article>
```

Both replace the element's children. `:html` does not sanitise — never pass
untrusted input.

### `:ref`

```html
<input :ref="inputEl" />
```

Assigns the element to `this.inputEl`. If that property holds a
`Signal.State`, the element is `.set()` into it instead. Cleared on unmount.

### `:model`

Two-way binding to a `Signal.State`:

```html
<input :model="name" />
<input type="checkbox" :model="agreed" />
<select :model="choice">…</select>
```

Modifiers: `.trim`, `.number`, `.lazy` (sync on `change` instead of `input`).

## Events

Any known DOM event name:

```html
<button :click="save()">Save</button>
<input :input="onInput($event)" />
<form :submit.prevent="submit()">…</form>
```

`$event` is available in inline expressions. An expression that is a bare
reference or an arrow function is used as the handler directly; anything else
is wrapped so it runs on each event.

```html
<button :click="handler">…</button>        <!-- used as-is -->
<button :click="() => save(1)">…</button>  <!-- used as-is -->
<button :click="save(1)">…</button>        <!-- wrapped -->
```

### Modifiers

| Modifier | Effect |
|---|---|
| `.stop` | `stopPropagation()` |
| `.prevent` | `preventDefault()` |
| `.self` | Only when `event.target` is this element |
| `.capture` `.once` `.passive` | Listener options |
| `.ctrl` `.alt` `.shift` `.meta` | Only with that modifier key held |
| `.enter` `.escape` `.tab` `.space` `.up` `.down` `.left` `.right` `.delete` `.backspace` | Only for that key |

```html
<input :keydown.enter="submit()" :keydown.escape="cancel()" />
<div :click.self.stop="close()">…</div>
```

### How listeners are attached

Events that bubble are **delegated**: Volt installs one listener per event
type on the document and dispatches by walking up from the target. A
thousand-row table with two handlers per row costs two listeners, not two
thousand, and adding or removing rows never touches the listener registry.

This is mostly invisible, with three consequences worth knowing:

- **DevTools shows no listener on the element.** The handler is stored on the
  node under a `$$click`-style property; the listener lives on `document`.
- **`event.currentTarget`** is set to the element the handler was attached to
  during the walk, so `.self` and manual comparisons behave as written.
- **`stopPropagation()` works**, including from a `.stop` modifier — it halts
  the walk as well as native bubbling.

Delegation is skipped, and a real listener attached, when:

- the event does not bubble — `focus`, `blur`, media and animation events
- you use `.capture`, `.once` or `.passive`, which need real listener options

You never choose between them; the compiler picks based on the event name and
modifiers.

### Custom and component events

`:on-*` forces an event listener for names Volt does not recognise:

```html
<v-counter :on-changed="onCount($event)"></v-counter>
<my-element :on-custom-thing="handle($event)"></my-element>
```

On a component this subscribes to the matching `@Output`. On a custom element
it is a real `addEventListener`.

## Bindings

```html
<input :value="text.get()" :disabled="busy.get()" :placeholder="hint" />
```

Volt writes the IDL property when the element has one and falls back to the
attribute otherwise. Boolean attributes are removed when falsy, never set to
`"false"`.

Force the choice when you need to:

```html
<div :attr-data-id="id.get()"></div>
<my-element :prop-config="config.get()"></my-element>
```

### `:class`

Accepts a string, an array, or an object:

```html
<div class="card" :class="{ active: isActive.get(), done: isDone.get() }"></div>
<div :class="['a', 'b']"></div>
<div :class="theme.get()"></div>
```

Classes written literally in `class` are **preserved** — only what the
binding added is ever removed.

A constant `:class` is folded into the markup: `:class="'btn'"` becomes
`class="btn"` with no runtime cost.

### `:style`

```html
<div :style="{ color: color.get(), fontWeight: 'bold' }"></div>
<div :style="'color: red'"></div>
```

Camel-case keys are hyphenated. Properties the binding previously set and no
longer includes are removed.

### `:spread`

```html
<div :spread="attrs.get()"></div>
```

## Slots

```html
<!-- v-card -->
<div class="card">
  <header><slot name="title">Untitled</slot></header>
  <main><slot></slot></main>
</div>
```

```html
<v-card>
  <h1 :slot="'title'">Hello</h1>
  <p>Body</p>
</v-card>
```

Content without `:slot` goes to the default slot. A `<slot>`'s children are
its fallback, used when nothing is projected.

## Grouping without an element

`<template>` groups nodes without producing DOM:

```html
<template :if="ready.get()">
  <h2>Title</h2>
  <p>Body</p>
</template>
```

## Comments and whitespace

Comments are stripped. Whitespace is condensed the way Vue does it:
whitespace-only text between elements that spans a line break is removed, and
other runs collapse to a single space. `<pre>`, `<textarea>`, `<script>`, and
`<style>` are left alone.
