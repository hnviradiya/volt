/**
 * Which phase the library's own measurements run in.
 *
 * The lane is worth nothing until the components use it: a scheduler that can
 * collapse every read in a flush into one forced layout, next to twenty
 * components that each read from a user effect, is the same number of layouts
 * as no lane at all. `strayReads` counts exactly that mistake, so a primitive
 * that goes back to measuring from `effect()` turns this file red.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Signal,
  createRoot,
  flushSync,
  getFlushMetrics,
  resetFlushMetrics,
  type Dispose,
} from '@voltdev/core';
import { createCollapsible } from '../src/disclosure.ts';
import { createScrollArea } from '../src/layout.ts';
import { createCode } from '../src/display-extras.ts';
import { createVirtualizer } from '../src/virtualizer.ts';
import { createTextarea } from '../src/inputs.ts';

let disposers: Dispose[] = [];
let elements: Element[] = [];

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  for (const el of elements) el.remove();
  elements = [];
  flushSync();
  vi.unstubAllGlobals();
});

function attach<T extends Element>(el: T): T {
  document.body.appendChild(el);
  elements.push(el);
  return el;
}

/** Build inside a root, then flush with the counters freshly zeroed. */
function measuring(build: () => void): void {
  disposers.push(
    createRoot((dispose) => {
      build();
      return dispose;
    }),
  );
  resetFlushMetrics();
  flushSync();
}

describe('the library measures from the measure lane', () => {
  it('reads a disclosure panel height without a stray layout', () => {
    const content = attach(document.createElement('div'));
    measuring(() => {
      createCollapsible({ content: () => content, defaultOpen: true });
    });

    expect(getFlushMetrics().strayReads).toBe(0);
  });

  it('reads the scroll area geometry without a stray layout', () => {
    const viewport = attach(document.createElement('div'));
    const inner = viewport.appendChild(document.createElement('div'));
    measuring(() => {
      createScrollArea({ viewport: () => viewport, content: () => inner });
    });

    // Six properties off one element, all inside the drain that paid for them.
    expect(getFlushMetrics().strayReads).toBe(0);
  });

  it('reads a code block overflow without a stray layout', () => {
    const pre = attach(document.createElement('pre'));
    measuring(() => {
      createCode({ block: true, pre: () => pre });
    });

    expect(getFlushMetrics().strayReads).toBe(0);
  });

  it('reads the virtualizer viewport and offset without a stray layout', () => {
    const scroller = attach(document.createElement('div'));
    measuring(() => {
      createVirtualizer({ scroller: () => scroller, count: () => 100, itemSize: 24 });
    });

    expect(getFlushMetrics().strayReads).toBe(0);
  });

  it('autosizes a textarea without a stray layout', () => {
    // happy-dom answers yes to `field-sizing`, and the declaration measures
    // nothing. The fallback is the path with a read in it.
    vi.stubGlobal('CSS', { supports: () => false });
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = attach(document.createElement('textarea'));
    const value = new Signal.State('');

    measuring(() => {
      createTextarea({ input: () => el, value });
    });
    expect(getFlushMetrics().strayReads).toBe(0);

    resetFlushMetrics();
    value.set('typed something considerably longer');
    flushSync();

    // The reset, the read and the write are three phases of one measurement,
    // and the read is the only one that costs a layout.
    expect(getFlushMetrics().strayReads).toBe(0);
    expect(getFlushMetrics().forcedLayouts).toBe(1);
    // Both writes are render effects. Putting either of them beside the read
    // — which is where they were — is what the drain's guard reports.
    expect(reported).not.toHaveBeenCalled();
    reported.mockRestore();
  });
});
