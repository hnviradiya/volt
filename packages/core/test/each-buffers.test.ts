/**
 * `:for` reuses its bookkeeping between reconciles, and that puts three things
 * at risk that a reconciler allocating fresh arrays every pass never had to
 * think about.
 *
 * Duplicate keys are the first: a key that names one row stores its index in
 * the map bare, and only a repeated key grows a bucket, so duplicates now take
 * a second path through the loop. The second is a list that shrinks, because a
 * buffer longer than the list is a buffer full of rows that no longer exist.
 * The third is the reuse marks, which are generation-stamped rather than
 * cleared, so the generation has to survive the end of the range it is stored
 * in.
 *
 * The identity assertions are the point of all of them: a row that survives a
 * change must be the same element afterwards, since that is what carries
 * focus, scroll position and a running transition across the update. The one
 * claim here that no assertion on DOM can reach is the marks handing their
 * room back, which is watched through the allocation instead; the rest of what
 * the reuse costs in bytes is measured in `each-memory.test.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';
import { createReuseMarks } from '../src/reuse-marks.js';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

@Component({
  selector: 'v-buf',
  render: compileTemplate(`<ul><li :for="s in items.get()" :key="s">{ s }</li></ul>`),
})
class Tags {
  items = new Signal.State<string[]>([]);
}

/** Mount the list and return a setter that flushes. */
function list(initial: string[]) {
  const instance = mount(Tags, host).instance as Tags;
  instance.items.set(initial);
  flushSync();
  return (next: string[]) => {
    instance.items.set(next);
    flushSync();
  };
}

const items = (): HTMLLIElement[] => [...host.querySelectorAll('li')];

/** Stamp every element so survivors can be told apart after a reconcile. */
function stamp(): void {
  items().forEach((el, i) => el.setAttribute('data-was', String(i)));
}

const stamps = (): (string | null)[] => items().map((el) => el.getAttribute('data-was'));

describe('duplicate keys', () => {
  it('pairs three of a kind up in order', () => {
    const set = list(['a', 'a', 'a', 'b']);
    stamp();

    set(['b', 'a', 'a', 'a']);

    expect(host.textContent).toBe('baaa');
    // The three `a` rows kept their order among themselves, and `b` moved.
    expect(stamps()).toEqual(['3', '0', '1', '2']);
  });

  it('keeps the survivors when one of a duplicate pair is dropped', () => {
    const set = list(['a', 'a', 'a']);
    stamp();

    set(['a', 'a']);

    expect(host.textContent).toBe('aa');
    expect(stamps()).toEqual(['0', '1']);
  });

  it('builds a new row when a key gains a duplicate', () => {
    const set = list(['a', 'b']);
    stamp();

    set(['a', 'a', 'b']);

    expect(host.textContent).toBe('aab');
    // The one previous `a` is claimed once; the second is genuinely new, and
    // reusing the same row twice would put one element in two places.
    expect(stamps()).toEqual(['0', null, '1']);
    expect(new Set(items()).size).toBe(3);
  });

  it('goes back to the single-row path once duplicates are gone', () => {
    const set = list(['a', 'a', 'b']);
    set(['a', 'b']);
    stamp();

    set(['b', 'a']);

    expect(host.textContent).toBe('ba');
    expect(stamps()).toEqual(['1', '0']);
  });

  it('reorders a list that is nothing but duplicates', () => {
    const set = list(['x', 'y', 'x', 'y', 'x']);
    stamp();

    set(['y', 'x', 'y', 'x', 'x']);

    expect(host.textContent).toBe('yxyxx');
    expect(stamps()).toEqual(['1', '0', '3', '2', '4']);
  });
});

describe('a list that spikes and shrinks', () => {
  const labels = (n: number, prefix = 'r'): string[] =>
    Array.from({ length: n }, (_, i) => prefix + i);

  it('shrinks to a handful and grows back', () => {
    const set = list(labels(1000));
    expect(items()).toHaveLength(1000);

    set(labels(2));
    expect(host.textContent).toBe('r0r1');

    stamp();
    set(labels(1000));

    expect(items()).toHaveLength(1000);
    expect(host.textContent).toBe(labels(1000).join(''));
    // The two survivors are the same elements; the rest are new.
    expect(stamps().slice(0, 3)).toEqual(['0', '1', null]);
  });

  // The size the buffer reuse was designed against, and the slowest test in
  // the package: happy-dom charges a scan of the parent's children for every
  // node removed, so dropping 99,950 of them takes seconds that a browser
  // would not.
  it('shrinks from 100,000 rows to 50 and grows back', { timeout: 60_000 }, () => {
    // happy-dom also caps `querySelectorAll` at 65,536 results, so this counts
    // through `children` instead. Both are limits of the environment.
    const rows = (): HTMLCollection => host.querySelector('ul')!.children;

    const set = list(labels(100_000));
    expect(rows()).toHaveLength(100_000);

    set(labels(50));
    expect(rows()).toHaveLength(50);
    expect(host.textContent).toBe(labels(50).join(''));

    const survivor = rows()[7]!;
    set(labels(100_000));

    expect(rows()).toHaveLength(100_000);
    // The 50 that were never dropped are still the same elements, and the
    // 99,950 rebuilt around them are in the right order.
    expect(rows()[7]).toBe(survivor);
    expect(rows()[99_999]!.textContent).toBe('r99999');
  });

  it('empties between two large lists', () => {
    const set = list(labels(500));
    set([]);
    expect(items()).toHaveLength(0);

    set(labels(500, 'q'));
    expect(items()).toHaveLength(500);
    expect(host.textContent).toBe(labels(500, 'q').join(''));
  });

  it('survives repeated spikes with nothing in common', () => {
    const set = list(labels(300, 'a'));
    for (let round = 0; round < 3; round++) {
      set(labels(300, `b${round}`));
      set(labels(4, `c${round}`));
      expect(host.textContent).toBe(labels(4, `c${round}`).join(''));
    }
  });
});

/**
 * The lengths of the `Int32Array`s allocated while `fn` runs.
 *
 * How much room the marks keep is not on `ReuseMarks`' surface — the point of
 * the design is that a caller cannot tell — so the only honest way to see a
 * buffer being handed back is to watch it being replaced.
 */
function stampBufferSizes(fn: () => void): number[] {
  const sizes: number[] = [];
  const real = globalThis.Int32Array;

  globalThis.Int32Array = new Proxy(real, {
    construct(target, args: [number]) {
      if (typeof args[0] === 'number') sizes.push(args[0]);
      return Reflect.construct(target, args) as Int32Array;
    },
  });
  try {
    fn();
  } finally {
    globalThis.Int32Array = real;
  }

  return sizes;
}

describe('reuse marks', () => {
  it('forgets the previous pass without being cleared', () => {
    const marks = createReuseMarks();

    marks.begin(4);
    marks.claim(2);
    expect(marks.claimed(2)).toBe(true);

    marks.begin(4);
    expect(marks.claimed(2)).toBe(false);
  });

  it('survives the generation reaching the end of the range', () => {
    // Two passes short of the last stamp an Int32Array can hold, so the third
    // pass is the one that would wrap negative and stop matching.
    const marks = createReuseMarks(0x7ffffffd);

    for (let pass = 0; pass < 4; pass++) {
      marks.begin(3);
      marks.claim(1);
      expect(marks.claimed(1), `pass ${pass}`).toBe(true);
      expect(marks.claimed(0), `pass ${pass}`).toBe(false);
    }
  });

  it('keeps marking after growing and shrinking', () => {
    const marks = createReuseMarks();

    marks.begin(2000);
    marks.claim(1999);
    expect(marks.claimed(1999)).toBe(true);

    // The reclaim is the cost this design was accepted with: a spike that is
    // well past has to be handed back, not held for as long as the list is on
    // screen. Without it the assertions below still pass on the stale buffer.
    const shrunk = stampBufferSizes(() => marks.begin(3));
    expect(shrunk).toHaveLength(1);
    expect(shrunk[0]).toBeLessThan(2000);

    marks.claim(2);
    expect(marks.claimed(2)).toBe(true);

    marks.begin(2000);
    marks.claim(1999);
    expect(marks.claimed(1999)).toBe(true);
    expect(marks.claimed(0)).toBe(false);
  });
});
