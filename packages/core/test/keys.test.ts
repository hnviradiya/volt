/**
 * `:for` keying.
 *
 * With no `:key`, rows are keyed by **item identity** — the Solid model.
 * Reordering therefore moves elements and takes their DOM state with them,
 * which is correct by default. `:key` exists for the case identity cannot
 * cover: data replaced with equal-but-new objects. `:key="$index"` opts back
 * into positional keying.
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
  selector: 'v-default',
  template: `<ul><li :for="item in items.get()">{{ item.text }}</li></ul>`,
})
class ByIdentity {
  items = new Signal.State<Item[]>(ITEMS);
}

@Component({
  selector: 'v-by-id',
  template: `<ul><li :for="item in items.get()" :key="item.id">{{ item.text }}</li></ul>`,
})
class ById {
  items = new Signal.State<Item[]>(ITEMS);
}

@Component({
  selector: 'v-by-index',
  template: `<ul><li :for="item in items.get()" :key="$index">{{ item.text }}</li></ul>`,
})
class ByIndex {
  items = new Signal.State<Item[]>(ITEMS);
}

describe('default: keyed by item identity', () => {
  it('reordering moves the existing elements', () => {
    const handle = mount(ByIdentity, host);
    const [a, b, c] = [...host.querySelectorAll('li')];

    (handle.instance as ByIdentity).items.set([...ITEMS].reverse());
    flushSync();

    expect([...host.querySelectorAll('li')]).toEqual([c, b, a]);
    expect(host.textContent).toBe('cba');
  });

  it('DOM state travels with the item, with no key needed', () => {
    const handle = mount(ByIdentity, host);
    // Stands in for focus, a typed-in value, a running transition, or a
    // child component's internal state.
    host.querySelectorAll('li')[0]!.setAttribute('data-state', 'belongs-to-a');

    (handle.instance as ByIdentity).items.set([...ITEMS].reverse());
    flushSync();

    const after = [...host.querySelectorAll('li')];
    expect(after[2]!.textContent).toBe('a');
    expect(after[2]!.getAttribute('data-state')).toBe('belongs-to-a');
  });

  it('removing from the front leaves the survivors untouched', () => {
    const handle = mount(ByIdentity, host);
    const [, b, c] = [...host.querySelectorAll('li')];

    (handle.instance as ByIdentity).items.set(ITEMS.slice(1));
    flushSync();

    expect([...host.querySelectorAll('li')]).toEqual([b, c]);
  });

  it('handles duplicate values by pairing them up in order', () => {
    @Component({
      selector: 'v-dupes',
      template: `<ul><li :for="s in items.get()">{{ s }}</li></ul>`,
    })
    class Dupes {
      items = new Signal.State(['a', 'b', 'a']);
    }

    const handle = mount(Dupes, host);
    expect(host.textContent).toBe('aba');

    (handle.instance as Dupes).items.set(['a', 'a', 'b']);
    flushSync();
    expect(host.textContent).toBe('aab');
  });

  it('rebuilds a row whose item was replaced by an equal-but-new object', () => {
    const handle = mount(ByIdentity, host);
    const first = host.querySelectorAll('li')[0]!;

    // A refetch returning fresh objects: identity changed, so the row is new.
    // This is the case `:key` exists for.
    (handle.instance as ByIdentity).items.set(ITEMS.map((i) => ({ ...i })));
    flushSync();

    expect(host.querySelectorAll('li')[0]!).not.toBe(first);
    expect(host.textContent).toBe('abc');
  });
});

describe(':key="item.id" — identity that survives replacement', () => {
  it('keeps the same elements when every object is replaced', () => {
    const handle = mount(ById, host);
    const before = [...host.querySelectorAll('li')];

    (handle.instance as ById).items.set(ITEMS.map((i) => ({ ...i })));
    flushSync();

    // Same ids, so the same elements — only the bindings re-ran.
    expect([...host.querySelectorAll('li')]).toEqual(before);
  });

  it('still moves elements on reorder', () => {
    const handle = mount(ById, host);
    const [a, b, c] = [...host.querySelectorAll('li')];

    (handle.instance as ById).items.set([...ITEMS].reverse());
    flushSync();

    expect([...host.querySelectorAll('li')]).toEqual([c, b, a]);
  });
});

describe(':key="$index" — explicit positional keying', () => {
  it('keeps elements in place and rewrites their contents', () => {
    const handle = mount(ByIndex, host);
    const [first, second, third] = [...host.querySelectorAll('li')];

    (handle.instance as ByIndex).items.set([...ITEMS].reverse());
    flushSync();

    expect([...host.querySelectorAll('li')]).toEqual([first, second, third]);
    expect(first.textContent).toBe('c');
  });

  it('is available alongside a named index binding', () => {
    @Component({
      selector: 'v-both',
      template: `<ul><li :for="(item, i) in items.get()" :key="$index">{{ i }}:{{ item.text }}</li></ul>`,
    })
    class Both {
      items = new Signal.State<Item[]>(ITEMS);
    }

    mount(Both, host);
    expect(host.textContent).toBe('0:a1:b2:c');
  });
});
