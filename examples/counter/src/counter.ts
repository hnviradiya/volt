import { Component, EventEmitter, Input, Output, Signal, type OnInit } from '@voltjs/core';

/**
 * A counter with a reactive input and an output event.
 *
 * `@Input() step` holds a `Signal.State`, so a binding from the parent flows
 * in through `.set()` and anything reading it updates on its own.
 */
@Component({
  selector: 'v-counter',
  template: `
    <div class="counter">
      <h2>{{ label.get() }}</h2>

      <div class="row">
        <button class="btn" :click="decrement()" :disabled="count.get() <= min.get()">−</button>
        <output class="value" :class="{ negative: count.get() < 0 }">{{ count.get() }}</output>
        <button class="btn" :click="increment()">+</button>
      </div>

      <p class="hint" :if="count.get() === 0">Nothing counted yet.</p>
      <p class="hint" :else-if="count.get() < 0">Below zero.</p>
      <p class="hint" :else>Counted {{ count.get() }} so far.</p>

      <button class="link" :click="reset()" :show="count.get() !== 0">Reset</button>
    </div>
  `,
  styles: `
    .counter { display: grid; gap: 0.75rem; }
    .counter .row { display: flex; align-items: center; gap: 0.75rem; }
    .counter .value { font-variant-numeric: tabular-nums; font-size: 2rem; min-width: 3ch; text-align: center; }
    .counter .value.negative { color: var(--danger); }
    .counter .hint { color: var(--muted); margin: 0; font-size: 0.9rem; }
  `,
})
export class Counter implements OnInit {
  @Input() label = new Signal.State('Counter');
  @Input() step = new Signal.State(1);
  @Input() min = new Signal.State(-Infinity);

  @Output() changed = new EventEmitter<number>();

  count = new Signal.State(0);

  onInit(): void {
    // Runs before the template is built, so the first paint already reflects it.
    this.changed.emit(this.count.get());
  }

  increment(): void {
    this.setCount(this.count.get() + this.step.get());
  }

  decrement(): void {
    this.setCount(this.count.get() - this.step.get());
  }

  reset(): void {
    this.setCount(0);
  }

  private setCount(next: number): void {
    this.count.set(next);
    this.changed.emit(next);
  }
}
