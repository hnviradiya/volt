import { Component, Prop, Signal, effect } from '@volt/core';

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
export class Counter {
  @Prop() label = new Signal.State('Counter');
  @Prop() step = new Signal.State(1);
  @Prop() min = new Signal.State(-Infinity);

  /** Called whenever the count changes. A plain function, passed in. */
  @Prop() onChanged?: (value: number) => void;

  count = new Signal.State(0);

  // Report the count to the parent, now and on every change. The first run is
  // deferred, so `onChanged` has already been supplied by the time it fires.
  #report = effect(() => this.onChanged?.(this.count.get()));

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
  }
}
