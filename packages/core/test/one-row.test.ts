/**
 * Changing one row in a large list must touch only that row.
 *
 * This is the guarantee that makes `memo`, `trackBy` and manual change
 * tracking unnecessary, so it is worth asserting rather than assuming. It
 * holds because of two independent things: keyed reconciliation reuses a row
 * whose key is unchanged, and a row's item signal only propagates when the
 * item is not the same object — so a wholesale array replacement where one
 * element differs wakes exactly one row's bindings.
 *
 * happy-dom caps `querySelectorAll` at 65,536 results, so this counts through
 * `children` instead. That is a limit of the test environment, not of Volt.
 */
import { describe, expect, it } from 'vitest';
import { compileTemplate } from '@volt/core/jit';
import { Component, Signal, flushSync, mount } from '@volt/core';

interface Row {
  id: number;
  label: Signal.State<string>;
}

@Component({
  selector: 'v-big',
  render: compileTemplate(`<ul><li :for="r in rows.get()" :key="r.id">{ r.label.get() }</li></ul>`),
})
class Big {
  rows = new Signal.State<Row[]>([]);
}

function build(n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) rows.push({ id: i, label: new Signal.State('row ' + i) });
  return rows;
}

describe('changing one row of many', () => {
  it('reuses every node and rewrites one, with no manual tracking', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const host = document.querySelector('#app')!;
    const app = mount(Big, host).instance as Big;

    const N = 100_000;
    const rows = build(N);
    app.rows.set(rows);
    flushSync();

    const list = host.querySelector('ul')!;
    const before = [...list.children] as HTMLElement[];
    const beforeText = before.map((el) => el.textContent);
    expect(before).toHaveLength(N);

    // A wholesale replacement with one element different — the shape an
    // immutable update produces, and the case that usually re-renders a list.
    const next = rows.slice();
    next[573] = { id: 573, label: new Signal.State('CHANGED') };
    app.rows.set(next);
    flushSync();

    const after = [...list.children] as HTMLElement[];
    const reused = after.filter((el, i) => el === before[i]).length;
    const rewritten = after.reduce((n, el, i) => n + (el.textContent !== beforeText[i] ? 1 : 0), 0);

    expect(after).toHaveLength(N);
    expect(reused).toBe(N);
    expect(rewritten).toBe(1);
    expect(after[573]!.textContent).toBe('CHANGED');
  }, 120_000);

  it('rewrites nothing when the array is replaced with an equal one', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const host = document.querySelector('#app')!;
    const app = mount(Big, host).instance as Big;

    const rows = build(1000);
    app.rows.set(rows);
    flushSync();

    const list = host.querySelector('ul')!;
    const before = [...list.children];

    // Same items, new array. Nothing has changed, and nothing should move.
    app.rows.set(rows.slice());
    flushSync();

    const after = [...list.children];
    expect(after.every((el, i) => el === before[i])).toBe(true);
  });
});
