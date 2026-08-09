# Lists and conditionals

## Conditionals

```html
<p :if="status.get() === 'loading'">Loading…</p>
<p :else-if="error.get()">{{ error.get() }}</p>
<p :else>{{ result.get() }}</p>
```

Conditions are tested in order and short-circuit. Only the winning branch is
built — the others never run.

Leaving a branch **disposes it**: its effects stop, their cleanups run, child
components receive `onDestroy`, and the DOM is removed. Entering a branch
builds it fresh.

```ts
@Component({
  selector: 'v-panel',
  imports: [HeavyChart],
  templateUrl: './panel.html',
})
export class Panel {
  expanded = new Signal.State(false);
}
```

The chart is not constructed until `expanded` is true, and is torn down when
it becomes false.

### Hiding without removing

`:if` creates and destroys. When you want the element to stay — to preserve
scroll position, a running animation, or a measured size — bind `display`
instead:

```html
<div :style="{ display: open.get() ? '' : 'none' }">…</div>
```

There is no `:show` directive for this. It would be five lines of framework
wrapping a style binding you can already write, and one that hides which CSS
property is being set.

Prefer `:if` when the content is expensive or genuinely absent: a hidden
element is still in the DOM, still in the accessibility tree, and still
built.

### Grouping

`<template>` applies a condition to several nodes without adding an element:

```html
<template :if="ready.get()">
  <h2>{{ title.get() }}</h2>
  <p>{{ body.get() }}</p>
</template>
```

## Lists

```html
<li :for="todo in todos.get()" :key="todo.id">{{ todo.text }}</li>
```

### Keys

`:key` is **required** on every `:for`. There is no default, because neither
candidate is safe:

- keying by **position** is cheap, but after a reorder the text updates
  correctly while focus, input values and animations stay behind on the wrong
  row — a bug that only surfaces once rows hold state
- keying by **object identity** is correct on reorder, but rebuilds the whole
  list when data is refetched as equal-but-new objects

```html
<li :for="todo in todos.get()" :key="todo.id">{{ todo.text }}</li>
```

With a stable key, reordering moves the existing elements and takes their DOM
state along; removing one leaves every other row untouched:

```ts
// The same three <li> elements move. They are not recreated.
todos.set([...todos.get()].reverse());
```

It also survives an immutable update, which identity alone cannot:

```ts
// A new object for one todo — with :key="todo.id" the row is reused and only
// the changed binding re-runs.
todos.set(todos.get().map(t => t.id === id ? { ...t, done: !t.done } : t));
```

Use `:key="$index"` when you genuinely want positional reuse — a fixed-length
list of slots that is never reordered.

### Index

```html
<li :for="(todo, i) in todos.get()" :key="todo.id">{{ i }}. {{ todo.text }}</li>
```

The index is reactive. When a keyed row moves, its DOM is reused and its
index binding updates on its own.

### Destructuring

```html
<li :for="{ id, text, done } in todos.get()" :key="id" :class="{ done }">
  {{ text }}
</li>
```

Each bound name becomes its own accessor, so destructured fields stay
reactive rather than being snapshotted when the row was created.

### Deriving the list

Filtering and sorting belong in a computed, not in the template:

```ts
export class Todos {
  todos = new Signal.State<Todo[]>([]);
  filter = new Signal.State<'all' | 'active'>('all');

  visible = new Signal.Computed(() =>
    this.filter.get() === 'active'
      ? this.todos.get().filter((t) => !t.done)
      : this.todos.get(),
  );
}
```

```html
<li :for="todo in visible.get()" :key="todo.id">{{ todo.text }}</li>
```

The computed re-evaluates only when the todos or the filter actually change,
and reconciliation keys off `todo.id`, so filtering moves existing rows
instead of rebuilding the list.

### Updating immutably

Signals compare with `Object.is` by default, so mutating an array in place
will not notify:

```ts
this.todos.get().push(item);        // nothing updates
this.todos.set([...this.todos.get(), item]);  // correct
```

If you would rather mutate, opt out of the comparison:

```ts
todos = new Signal.State<Todo[]>([], { equals: () => false });
```
