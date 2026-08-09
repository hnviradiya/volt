# Inputs, outputs, and slots

## Passing data down

```ts
@Component({
  selector: 'v-badge',
  template: `<span class="badge">{{ count.get() }}</span>`,
})
export class Badge {
  @Input() count = new Signal.State(0);
}
```

```html
<v-badge :count="unread.get()"></v-badge>
```

The binding stays live. When `unread` changes, the badge's text updates —
neither component re-renders, and no diff runs.

### Choosing an input form

```ts
@Input() a = new Signal.State(0);  // reactive; read as a.get()
@Input() accessor b = 0;           // reactive; read as b
@Input() c = 0;                    // not reactive
```

Use the first when the child passes the signal around, the second when you
want the ergonomics of a plain property, the third only for values that never
change after construction.

## Sending events up

```ts
export class Editor {
  @Output() saved = new EventEmitter<string>();

  save() {
    this.saved.emit(this.text.get());
  }
}
```

```html
<v-editor :on-saved="persist($event)"></v-editor>
```

`:on-*` is required for component outputs — a bare `:saved` would be read as
a property binding, since `saved` is not a DOM event.

## Two-way binding

`:model` on a component pairs a `modelValue` input with an
`update:modelValue` output:

```html
<v-text-field :model="name"></v-text-field>
```

## Slots

```html
<!-- v-card -->
<div class="card">
  <header><slot name="title">Untitled</slot></header>
  <main><slot></slot></main>
  <footer><slot name="actions"></slot></footer>
</div>
```

```html
<v-card>
  <h2 :slot="'title'">Settings</h2>

  <p>Body content goes to the default slot.</p>

  <template :slot="'actions'">
    <button :click="cancel()">Cancel</button>
    <button :click="save()">Save</button>
  </template>
</v-card>
```

A `<slot>`'s children are its fallback, rendered when nothing is projected.

Slot content is compiled in the **parent's** scope, so it reads the parent's
state and calls the parent's methods — exactly where it is written.

## Component references

```html
<v-editor :ref="editor"></v-editor>
```

```ts
export class Page {
  editor: Editor | null = null;

  onMount() {
    this.editor?.focus();
  }
}
```

## When not to use inputs

Threading a value through several layers of inputs is a sign it should live
in a module or a context instead:

```ts
// store.ts
export const theme = new Signal.State<'light' | 'dark'>('light');
```

Any component can import and read it. Because signals track precisely, only
the components that actually read `theme` update when it changes — there is
no provider to re-render.
