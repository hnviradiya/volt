import { Component, Signal } from '@voltdev/core';

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
  templateUrl: './todos.html',
  styleUrl: './todos.scss',
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
