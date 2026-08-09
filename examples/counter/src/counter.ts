import { Component, Prop, Signal, type OnInit } from '@voltjs/core';

/**
 * A counter with a reactive prop and a callback prop.
 *
 * `@Prop() step` holds a `Signal.State`, so a binding from the parent flows
 * in through `.set()` and anything reading it updates on its own. `onChanged`
 * is a plain function the parent passes in, which this component calls.
 */
@Component({
  selector: 'v-counter',
  templateUrl: './counter.html',
  styleUrl: './counter.scss',
})
export class Counter implements OnInit {
  @Prop() label = new Signal.State('Counter');
  @Prop() step = new Signal.State(1);
  @Prop() min = new Signal.State(-Infinity);

  /** Called whenever the count changes. A plain function, passed in. */
  @Prop() onChanged?: (value: number) => void;

  count = new Signal.State(0);

  onInit(): void {
    // Runs before the template is built, so the first paint already reflects it.
    this.onChanged?.(this.count.get());
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
    this.onChanged?.(next);
  }
}
