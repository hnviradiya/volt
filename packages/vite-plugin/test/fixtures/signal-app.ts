/**
 * An application module, built twice by `bundle.test.ts` — once with the
 * `Signal` lowering on and once with it off — and then executed from the
 * bundle either build produced.
 *
 * It reaches all three shapes the pass rewrites (`State`, `Computed`,
 * `subtle.*`) and asks a question only the real bindings can answer:
 * `instanceof Signal.State` is true after lowering only if the lowered import
 * and the namespace member are the same class.
 */

import { Signal, effect, flushSync } from '@voltdev/reactivity';

export function run(): { seen: number[]; peeked: number; sameClass: boolean } {
  const count = new Signal.State(1);
  const doubled = new Signal.Computed(() => count.get() * 2);
  const seen: number[] = [];

  effect(() => {
    seen.push(doubled.get());
  });
  flushSync();

  count.set(4);
  flushSync();

  return {
    seen,
    peeked: Signal.subtle.untrack(() => count.get()),
    sameClass: count instanceof Signal.State,
  };
}
