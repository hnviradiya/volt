/**
 * Tearing a keyed list down must stay linear in its length.
 *
 * `clear` and `replace` in js-framework-benchmark are dominated by this, and
 * nothing else in the suite would notice it going quadratic: correctness tests
 * use small lists, where the difference is invisible. It has gone quadratic
 * twice — once when scope children became an array and detaching searched for
 * its own slot, and once when `Watcher.unwatch` searched and spliced its
 * source list. Both were only visible at scale.
 *
 * The assertion is on the shape of the curve, not on absolute time, so it does
 * not depend on how fast the machine running it is.
 */
import { describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Prop, Signal, createRoot, flushSync, mount, renderEffect } from '@voltdev/core';

interface Item {
  id: number;
  label: Signal.State<string>;
}

@Component({
  selector: 'v-row',
  render: compileTemplate(
    `<tr :class="{ danger: selected.get() === id }"><td>{ label.get() }</td></tr>`,
  ),
})
class Row {
  @Prop() id = 0;
  @Prop() label = new Signal.State('');
  @Prop() selected = new Signal.State(-1);
}

@Component({
  selector: 'v-list',
  imports: [Row],
  render: compileTemplate(
    `<table><tbody><v-row :for="it in items.get()" :key="it.id"
       :id="it.id" :label="it.label" :selected="selected"></v-row></tbody></table>`,
  ),
})
class List {
  items = new Signal.State<Item[]>([]);
  selected = new Signal.State(-1);
}

function build(n: number): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < n; i++) out.push({ id: i, label: new Signal.State('row ' + i) });
  return out;
}

/** Milliseconds to clear a mounted list of `n` rows. */
function timeClear(n: number): number {
  document.body.innerHTML = '<div id="app"></div>';
  const host = document.querySelector('#app')!;
  const handle = mount(List, host);
  const list = handle.instance as List;

  list.items.set(build(n));
  flushSync();

  const start = performance.now();
  list.items.set([]);
  flushSync();
  const elapsed = performance.now() - start;

  handle.unmount();
  return elapsed;
}

/**
 * How much slower `large` is than `small`, at its most favourable.
 *
 * The two sizes are measured back to back and the ratio taken per pair, rather
 * than each size being timed to its own best and the bests divided. On a
 * machine with something else running — a shared CI runner, a VM on a
 * developer's box — the load does not politely pause between the two halves of
 * the measurement, and the longer run absorbs more of it, which inflates the
 * ratio without anything having regressed. Pairing means a spike lands on both
 * sides at once, and the best pair is the one that got the quietest window.
 *
 * The signal being watched for is 16x against a threshold of 8x, so being
 * generous about noise costs nothing that matters.
 */
function growth(measure: (n: number) => number, small: number, large: number, pairs = 5): number {
  let best = Infinity;
  for (let i = 0; i < pairs; i++) {
    const a = measure(small);
    const b = measure(large);
    best = Math.min(best, b / Math.max(a, 0.001));
  }
  return best;
}

describe('list teardown', () => {
  it('clears a list in time linear in its length', () => {
    timeClear(200); // warm the JIT

    // Four times the rows should cost about four times as much. Quadratic
    // teardown would cost sixteen, so anything past 8x is unambiguous.
    const ratio = growth(timeClear, 1000, 4000);
    expect(ratio, `4000 rows cost ${ratio.toFixed(1)}x 1000 rows`).toBeLessThan(8);
  }, 120_000);

  it('disposes many sibling scopes without searching for each one', () => {
    // The same failure one layer down, and the cheaper place to catch it:
    // effects unwatched one at a time, as every row of a list is.
    const measure = (n: number) => {
      const disposers: (() => void)[] = [];
      const shared = new Signal.State(0);
      const stop = mountScopes(n, shared, disposers);

      const start = performance.now();
      for (const dispose of disposers) dispose();
      flushSync();
      const elapsed = performance.now() - start;

      stop();
      return elapsed;
    };

    measure(500); // warm

    const ratio = growth(measure, 1000, 4000);
    expect(ratio, `4000 scopes cost ${ratio.toFixed(1)}x 1000 scopes`).toBeLessThan(8);
  }, 120_000);
});

function mountScopes(
  n: number,
  shared: Signal.State<number>,
  disposers: (() => void)[],
): () => void {
  let stop: () => void = () => {};
  createRoot((disposeAll) => {
    stop = disposeAll;
    for (let i = 0; i < n; i++) {
      createRoot((dispose) => {
        disposers.push(dispose);
        const own = new Signal.State(i);
        renderEffect(() => void own.get());
        renderEffect(() => void (shared.get() === i));
      });
    }
  });
  flushSync();
  return stop;
}
