/**
 * `:for` keying.
 *
 * `:key` is mandatory. Neither possible default is safe — keying by position
 * strands DOM state on the wrong row after a reorder, and keying by object
 * identity rebuilds the whole list when data is refetched — so the choice is
 * the author's, every time.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import { Component, Signal, flushSync, mount } from '@voltdev/core';

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
  selector: 'v-by-id',
  render: compileTemplate(`<ul><li :for="item in items.get()" :key="item.id">{ item.text }</li></ul>`),
})
class ById {
  items = new Signal.State<Item[]>(ITEMS);
}

@Component({
  selector: 'v-by-index',
  render: compileTemplate(`<ul><li :for="item in items.get()" :key="$index">{ item.text }</li></ul>`),
})
class ByIndex {
  items = new Signal.State<Item[]>(ITEMS);
}

describe(':key is required', () => {
  it('refuses to compile a `:for` without one', () => {
    expect(() => compileTemplate(`<ul><li :for="x in xs.get()">{ x }</li></ul>`)).toThrow(
      /`:for` requires `:key`/,
    );
  });

  it('names both remedies in the error', () => {
    let message = '';
    try {
      compileTemplate(`<ul><li :for="x in xs.get()">{ x }</li></ul>`);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(':key="item.id"');
    expect(message).toContain(':key="$index"');
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

  it('moves elements on reorder, taking their DOM state along', () => {
    const handle = mount(ById, host);
    const [a, b, c] = [...host.querySelectorAll('li')];
    // Stands in for focus, a typed-in value, or a running transition.
    a.setAttribute('data-state', 'belongs-to-a');

    (handle.instance as ById).items.set([...ITEMS].reverse());
    flushSync();

    const after = [...host.querySelectorAll('li')];
    expect(after).toEqual([c, b, a]);
    expect(after[2]!.getAttribute('data-state')).toBe('belongs-to-a');
  });

  it('leaves the survivors untouched when one row is removed', () => {
    const handle = mount(ById, host);
    const [, b, c] = [...host.querySelectorAll('li')];

    (handle.instance as ById).items.set(ITEMS.slice(1));
    flushSync();

    expect([...host.querySelectorAll('li')]).toEqual([b, c]);
  });

  it('pairs duplicate keys up in order', () => {
    @Component({
      selector: 'v-dupes',
      render: compileTemplate(`<ul><li :for="s in items.get()" :key="s">{ s }</li></ul>`),
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
      render: compileTemplate(`<ul><li :for="(item, i) in items.get()" :key="$index">{ i }:{ item.text }</li></ul>`),
    })
    class Both {
      items = new Signal.State<Item[]>(ITEMS);
    }

    mount(Both, host);
    expect(host.textContent).toBe('0:a1:b2:c');
  });
});
