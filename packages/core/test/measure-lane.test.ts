/**
 * The measure lane, through the public component API.
 *
 * The reactivity tests pin the phase order against signals; this one proves
 * the phase is worth having — that a measure effect reads a DOM the compiled
 * template has already patched, and still runs before any user work writes to
 * it again.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { compileTemplate } from '@voltdev/core/jit';
import {
  Component,
  Signal,
  effect,
  flushSync,
  getFlushMetrics,
  measureEffect,
  mount,
  resetFlushMetrics,
} from '@voltdev/core';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

describe('measureEffect in a component', () => {
  it('reads the patched DOM, ahead of the user effects that write to it', () => {
    const label = new Signal.State('short');
    const order: string[] = [];
    const text = () => host.querySelector('p')?.textContent;

    @Component({ selector: 'v-measured', render: compileTemplate(`<p>{ label.get() }</p>`) })
    class Measured {
      label = label;

      // Created first, and still last to run.
      #user = effect(() => {
        label.get();
        order.push(`user:${text()}`);
      });

      #measure = measureEffect(() => {
        label.get();
        order.push(`measure:${text()}`);
      });
    }

    const handle = mount(Measured, host);
    flushSync();
    order.length = 0;

    resetFlushMetrics();
    label.set('a considerably longer label');
    flushSync();

    expect(order).toEqual([
      'measure:a considerably longer label',
      'user:a considerably longer label',
    ]);
    // The write and the read shared one layout.
    expect(getFlushMetrics().forcedLayouts).toBe(1);

    handle.unmount();
    label.set('gone');
    flushSync();
    expect(order).toHaveLength(2);
  });
});
