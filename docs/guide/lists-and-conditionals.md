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

### `:if` vs `:show`

`:if` creates and destroys. `:show` toggles `display` on an element that is
always present.

Use `:if` when the content is expensive or usually absent. Use `:show` when
it toggles often and is cheap to keep around.

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

Rows are keyed by **item identity** unless you say otherwise, so reordering
is correct without writing anything:

```ts
// The same three <li> elements move; they are not recreated, and any focus,
// input value, or running transition moves with them.
todos.set([...todos.get()].reverse());
```

This is deliberate. Frameworks that key by position instead will happily
render the right text after a reorder while leaving a checkbox ticked on the
wrong row — a bug that only shows up once rows hold state.

`:key` covers the case identity cannot:

```html
<li :for="todo in todos.get()" :key="todo.id">{{ todo.text }}</li>
```

Use it when items are **replaced rather than moved** — an immutable update
like `todos.map(t => t.id === id ? { ...t, done: !t.done } : t)` produces a
new object, and without a key that row is torn down and rebuilt. With
`:key="todo.id"` the row survives and only the changed binding re-runs.

`:key="$index"` opts back into positional keying, which is occasionally what
you want for a fixed-length list of slots.

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
