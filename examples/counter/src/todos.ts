import { Component, Signal } from '@voltjs/core';

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

type Filter = 'all' | 'active' | 'done';

/**
 * A keyed list with derived state.
 *
 * `visible` is a `Signal.Computed`, so it re-evaluates only when the todos or
 * the filter actually change — and because rows are keyed by id, toggling one
 * todo re-runs that row's bindings and leaves every other row's DOM alone.
 */
@Component({
  selector: 'v-todos',
  template: `
    <section class="todos">
      <h2>Todos</h2>

      <form class="add" :submit.prevent="add()">
        <input
          class="input"
          placeholder="What needs doing?"
          :model.trim="draft"
          :keydown.escape="draft.set('')"
        />
        <button class="btn primary" :disabled="draft.get().length === 0">Add</button>
      </form>

      <div class="filters">
        <button
          :for="option in filters"
          :key="option"
          class="chip"
          :class="{ active: filter.get() === option }"
          :click="filter.set(option)"
        >
          {{ option }}
        </button>
      </div>

      <ul class="list">
        <li :for="todo in visible.get()" :key="todo.id" :class="{ done: todo.done }">
          <label>
            <input type="checkbox" :checked="todo.done" :change="toggle(todo.id)" />
            <span class="text">{{ todo.text }}</span>
          </label>
          <button class="link" :click="remove(todo.id)" aria-label="Remove">×</button>
        </li>
      </ul>

      <p class="empty" :if="visible.get().length === 0">Nothing here.</p>

      <footer class="summary">
        {{ remaining.get() }} of {{ todos.get().length }} remaining
      </footer>
    </section>
  `,
  styles: `
    .todos { display: grid; gap: 1rem; }
    .todos .add { display: flex; gap: 0.5rem; }
    .todos .input { flex: 1; }
    .todos .filters { display: flex; gap: 0.5rem; }
    .todos .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; }
    .todos .list li { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.4rem 0.6rem; border-radius: 8px; background: var(--surface-2); }
    .todos .list li.done .text { text-decoration: line-through; color: var(--muted); }
    .todos label { display: flex; align-items: center; gap: 0.6rem; cursor: pointer; }
    .todos .empty, .todos .summary { color: var(--muted); font-size: 0.9rem; margin: 0; }
  `,
})
export class Todos {
  readonly filters: Filter[] = ['all', 'active', 'done'];

  draft = new Signal.State('');
  filter = new Signal.State<Filter>('all');

  todos = new Signal.State<Todo[]>([
    { id: 1, text: 'Read the TC39 signals proposal', done: true },
    { id: 2, text: 'Build a framework on it', done: false },
    { id: 3, text: 'Write the docs', done: false },
  ]);

  visible = new Signal.Computed<Todo[]>(() => {
    const all = this.todos.get();
    switch (this.filter.get()) {
      case 'active':
        return all.filter((t) => !t.done);
      case 'done':
        return all.filter((t) => t.done);
      default:
        return all;
    }
  });

  remaining = new Signal.Computed(() => this.todos.get().filter((t) => !t.done).length);

  private nextId = 4;

  add(): void {
    const text = this.draft.get().trim();
    if (!text) return;
    this.todos.set([...this.todos.get(), { id: this.nextId++, text, done: false }]);
    this.draft.set('');
  }

  toggle(id: number): void {
    this.todos.set(
      this.todos.get().map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    );
  }

  remove(id: number): void {
    this.todos.set(this.todos.get().filter((t) => t.id !== id));
  }
}
