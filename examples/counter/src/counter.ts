import { Component, EventEmitter, Input, Output, Signal, type OnInit } from '@voltjs/core';

/**
 * A counter with a reactive input and an output event.
 *
 * `@Input() step` holds a `Signal.State`, so a binding from the parent flows
 * in through `.set()` and anything reading it updates on its own.
 */
@Component({
  selector: 'v-counter',
  templateUrl: './counter.html',
  styleUrl: './counter.scss',
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
