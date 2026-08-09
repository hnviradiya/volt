/**
 * What `:key` actually changes.
 *
 * Without it, rows are keyed by index: the element at position N is reused
 * for whatever item lands at position N. The rendered text is still correct,
 * so the difference is invisible until something is attached to a specific
 * element — DOM state, focus, a component instance, an animation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import '@voltjs/core/jit';
import { Component, Signal, flushSync, mount } from '@voltjs/core';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

interface Item {
  id: number;
  text: string;
}

const ITEMS: Item[] = [
  { id: 1, text: 'a' },
  { id: 2, text: 'b' },
  { id: 3, text: 'c' },
];

@Component({
  selector: 'v-keyed',
  template: `<ul><li :for="item in items.get()" :key="item.id">{{ item.text }}</li></ul>`,
})
class Keyed {
  items = new Signal.State<Item[]>(ITEMS);
}

@Component({
  selector: 'v-unkeyed',
  template: `<ul><li :for="item in items.get()">{{ item.text }}</li></ul>`,
})
class Unkeyed {
  items = new Signal.State<Item[]>(ITEMS);
}

describe('rendered output is identical either way', () => {
  it('keyed and unkeyed both render correctly after a reorder', () => {
    for (const Component of [Keyed, Unkeyed]) {
      document.body.innerHTML = '<div id="app"></div>';
      const el = document.querySelector('#app')!;
      const handle = mount(Component, el);

      expect(el.textContent).toBe('abc');

      (handle.instance as Keyed).items.set([...ITEMS].reverse());
      flushSync();

      // Both produce the right text — this is why the difference hides.
      expect(el.textContent).toBe('cba');
      handle.unmount();
    }
  });
});

describe('element identity is what differs', () => {
  it('keyed: reordering moves the existing elements', () => {
    const handle = mount(Keyed, host);
    const [a, b, c] = [...host.querySelectorAll('li')];

    (handle.instance as Keyed).items.set([...ITEMS].reverse());
    flushSync();

    // The same three elements, in the new order.
    expect([...host.querySelectorAll('li')]).toEqual([c, b, a]);
  });

  it('unkeyed: reordering keeps elements in place and rewrites their text', () => {
    const handle = mount(Unkeyed, host);
    const [first, second, third] = [...host.querySelectorAll('li')];

    (handle.instance as Unkeyed).items.set([...ITEMS].reverse());
    flushSync();

    // Positions are unchanged; only the content moved.
    expect([...host.querySelectorAll('li')]).toEqual([first, second, third]);
    expect(first.textContent).toBe('c');
  });
});

describe('why it matters in practice', () => {
  it('keyed: DOM state travels with the item', () => {
    const handle = mount(Keyed, host);
    const rows = [...host.querySelectorAll('li')];
    // Stand in for anything attached to an element: focus, scroll offset,
    // a typed-in value, a running transition, a component instance.
    rows[0]!.setAttribute('data-state', 'belongs-to-a');

    (handle.instance as Keyed).items.set([...ITEMS].reverse());
    flushSync();

    const after = [...host.querySelectorAll('li')];
    // 'a' moved to the end, and its state went with it.
    expect(after[2]!.getAttribute('data-state')).toBe('belongs-to-a');
    expect(after[2]!.textContent).toBe('a');
  });

  it('unkeyed: DOM state is stranded at the old position', () => {
    const handle = mount(Unkeyed, host);
    const rows = [...host.querySelectorAll('li')];
    rows[0]!.setAttribute('data-state', 'belongs-to-a');

    (handle.instance as Unkeyed).items.set([...ITEMS].reverse());
    flushSync();

    const after = [...host.querySelectorAll('li')];
    // The state stayed at position 0, which now shows 'c'.
    expect(after[0]!.getAttribute('data-state')).toBe('belongs-to-a');
    expect(after[0]!.textContent).toBe('c');
  });

  it('keyed: removing from the front leaves the surviving rows untouched', () => {
    const handle = mount(Keyed, host);
    const [, b, c] = [...host.querySelectorAll('li')];

    (handle.instance as Keyed).items.set(ITEMS.slice(1));
    flushSync();

    // One element removed; the other two are the very same nodes.
    expect([...host.querySelectorAll('li')]).toEqual([b, c]);
  });

  it('unkeyed: removing from the front rewrites every row after it', () => {
    const handle = mount(Unkeyed, host);
    const [first, second] = [...host.querySelectorAll('li')];

    (handle.instance as Unkeyed).items.set(ITEMS.slice(1));
    flushSync();

    // The last element is dropped and every remaining row's text is rewritten,
    // which is O(n) updates for a one-item removal.
    const after = [...host.querySelectorAll('li')];
    expect(after).toEqual([first, second]);
    expect(after[0]!.textContent).toBe('b');
  });
});
