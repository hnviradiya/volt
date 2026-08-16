/**
 * List reconciliation, exercised the way Solid's `for` suite does.
 *
 * The mutation shapes here — rotations, backward-edge swaps, every
 * combination of removals — are the ones that break diffing algorithms, and
 * they are checked twice over: the resulting text must be right, and the
 * elements that survived must be the *same* elements, since reusing a node is
 * the entire point of keying.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

@Component({
  selector: 'v-rows',
  render: compileTemplate(`<ul><li :for="n in items.get()" :key="n">{ n }</li></ul>`),
})
class Rows {
  items = new Signal.State<number[]>([]);
}

/** Mount with `from`, apply `to`, and report text plus which nodes survived. */
function reconcile(from: number[], to: number[]) {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;

  const handle = mount(Rows, host);
  const instance = handle.instance as Rows;
  instance.items.set(from);
  flushSync();

  const before = new Map<string, Element>();
  for (const li of host.querySelectorAll('li')) before.set(li.textContent!, li);

  instance.items.set(to);
  flushSync();

  const after = [...host.querySelectorAll('li')];
  const reused = after.filter((li) => before.get(li.textContent!) === li).length;

  return {
    text: after.map((li) => li.textContent).join(','),
    reused,
    survivors: to.filter((n) => from.includes(n)).length,
  };
}

/** Every survivor must be the very same element it was before. */
function expectReconciled(from: number[], to: number[]) {
  const r = reconcile(from, to);
  expect(r.text, `${from} -> ${to}`).toBe(to.join(','));
  expect(r.reused, `${from} -> ${to}: reused nodes`).toBe(r.survivors);
}

const FIVE = [1, 2, 3, 4, 5];

describe('removals', () => {
  it('removes one from each position', () => {
    for (const drop of FIVE) {
      expectReconciled(FIVE, FIVE.filter((n) => n !== drop));
    }
  });

  it('removes two at a time, every pair', () => {
    for (let i = 0; i < FIVE.length; i++) {
      for (let j = i + 1; j < FIVE.length; j++) {
        const dropped = new Set([FIVE[i]!, FIVE[j]!]);
        expectReconciled(FIVE, FIVE.filter((n) => !dropped.has(n)));
      }
    }
  });

  it('removes three at a time', () => {
    expectReconciled(FIVE, [4, 5]);
    expectReconciled(FIVE, [1, 5]);
    expectReconciled(FIVE, [1, 2]);
    expectReconciled(FIVE, [2, 4]);
  });

  it('removes all', () => expectReconciled(FIVE, []));
});

describe('insertions', () => {
  it('inserts at the front, middle, and end', () => {
    expectReconciled(FIVE, [0, ...FIVE]);
    expectReconciled(FIVE, [1, 2, 99, 3, 4, 5]);
    expectReconciled(FIVE, [...FIVE, 6]);
  });

  it('grows from empty', () => expectReconciled([], FIVE));

  it('interleaves new items throughout', () => {
    expectReconciled(FIVE, [1, 10, 2, 20, 3, 30, 4, 40, 5]);
  });
});

describe('moves', () => {
  it('reverses', () => expectReconciled(FIVE, [...FIVE].reverse()));

  it('rotates left and right', () => {
    expectReconciled(FIVE, [2, 3, 4, 5, 1]);
    expectReconciled(FIVE, [5, 1, 2, 3, 4]);
    expectReconciled(FIVE, [3, 4, 5, 1, 2]);
  });

  it('swaps adjacent pairs', () => expectReconciled(FIVE, [2, 1, 4, 3, 5]));

  it('swaps the outer edges', () => expectReconciled(FIVE, [5, 2, 3, 4, 1]));

  it('swaps a backward edge', () => {
    // The case where the first new item is the last old one and vice versa.
    expectReconciled([1, 2, 3, 4], [4, 3, 2, 1]);
    expectReconciled([1, 2], [2, 1]);
  });

  it('moves one item to the far end', () => {
    expectReconciled(FIVE, [2, 3, 4, 5, 1]);
    expectReconciled(FIVE, [5, 1, 2, 3, 4]);
  });
});

describe('mixed mutations', () => {
  it('removes and inserts at once', () => {
    expectReconciled(FIVE, [1, 99, 3, 5]);
    expectReconciled(FIVE, [99, 2, 4, 98]);
  });

  it('reorders while removing', () => {
    expectReconciled(FIVE, [5, 3, 1]);
    expectReconciled(FIVE, [4, 2]);
  });

  it('replaces everything', () => {
    const r = reconcile(FIVE, [6, 7, 8, 9, 10]);
    expect(r.text).toBe('6,7,8,9,10');
    expect(r.reused).toBe(0);
  });

  it('handles a longer shuffle', () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expectReconciled(ten, [10, 3, 7, 1, 9, 2, 8, 4, 6, 5]);
    expectReconciled(ten, [5, 1, 9, 3]);
  });

  it('empties and refills repeatedly', () => {
    document.body.innerHTML = '<div id="app"></div>';
    host = document.querySelector('#app')!;
    const handle = mount(Rows, host);
    const instance = handle.instance as Rows;

    for (let i = 0; i < 5; i++) {
      instance.items.set(FIVE);
      flushSync();
      expect(host.querySelectorAll('li')).toHaveLength(5);
      instance.items.set([]);
      flushSync();
      expect(host.querySelectorAll('li')).toHaveLength(0);
    }
  });
});

describe('surrounding content is not disturbed', () => {
  it('keeps siblings either side of the list', () => {
    @Component({
      selector: 'v-sandwich',
      render: compileTemplate(`
        <div>
          <header>top</header>
          <ul><li :for="n in items.get()" :key="n">{ n }</li></ul>
          <footer>bottom</footer>
        </div>
      `),
    })
    class Sandwich {
      items = new Signal.State([1, 2, 3]);
    }

    const handle = mount(Sandwich, host);
    const header = host.querySelector('header')!;
    const footer = host.querySelector('footer')!;

    (handle.instance as Sandwich).items.set([3, 1]);
    flushSync();

    expect(host.querySelector('header')).toBe(header);
    expect(host.querySelector('footer')).toBe(footer);
    expect(host.querySelector('ul')!.textContent).toBe('31');
  });

  it('keeps two independent lists apart', () => {
    @Component({
      selector: 'v-two',
      render: compileTemplate(`
        <div>
          <ul class="a"><li :for="n in a.get()" :key="n">{ n }</li></ul>
          <ul class="b"><li :for="n in b.get()" :key="n">{ n }</li></ul>
        </div>
      `),
    })
    class Two {
      a = new Signal.State([1, 2]);
      b = new Signal.State([3, 4]);
    }

    const handle = mount(Two, host);
    (handle.instance as Two).a.set([2, 1]);
    flushSync();

    expect(host.querySelector('ul.a')!.textContent).toBe('21');
    expect(host.querySelector('ul.b')!.textContent).toBe('34');
  });
});
