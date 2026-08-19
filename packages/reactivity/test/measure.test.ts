/**
 * The measure lane.
 *
 * Reading geometry forces the engine to lay out everything written since the
 * last frame, so the phase a read happens in is the difference between one
 * forced layout per flush and one per component. These tests pin the phase
 * order, the read-only contract, and the accounting that proves the lane is
 * still working.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  Signal,
  createRoot,
  effect,
  flushSync,
  getFlushMetrics,
  measureEffect,
  renderEffect,
  resetFlushMetrics,
} from '@voltdev/reactivity';

describe('phase order', () => {
  it('drains render effects, then measures, then user effects', () => {
    const source = new Signal.State(0);
    const order: string[] = [];

    // Declared back to front: the order below is the scheduler's, not the
    // order they were created in.
    const dispose = createRoot((d) => {
      effect(() => {
        source.get();
        order.push('user');
      });
      measureEffect(() => {
        source.get();
        order.push('measure');
      });
      renderEffect(() => {
        source.get();
        order.push('render');
      });
      return d;
    });

    expect(order).toEqual(['render']);
    flushSync();
    expect(order).toEqual(['render', 'measure', 'user']);

    order.length = 0;
    source.set(1);
    flushSync();
    expect(order).toEqual(['render', 'measure', 'user']);
    dispose();
  });

  it('measures only once render effects have reached a fixed point', () => {
    const raw = new Signal.State(1);
    const step = new Signal.State(0);
    const settled = new Signal.State(0);
    const seen: number[] = [];

    const dispose = createRoot((d) => {
      renderEffect(() => step.set(raw.get() * 10));
      // A second render pass: it only sees `step` after the first one wrote.
      renderEffect(() => settled.set(step.get() + 1));
      measureEffect(() => void seen.push(settled.get()));
      return d;
    });

    flushSync();
    expect(seen).toEqual([11]);

    raw.set(2);
    flushSync();
    // 11 would mean the measure drained between the two render passes.
    expect(seen).toEqual([11, 21]);
    dispose();
  });

  it('applies a signal written from a measure before user effects run', () => {
    const trigger = new Signal.State(1);
    const height = new Signal.State(0);
    const order: string[] = [];

    const dispose = createRoot((d) => {
      renderEffect(() => {
        trigger.get();
        order.push('render');
      });
      renderEffect(() => void order.push(`apply:${height.get()}`));
      measureEffect(() => {
        order.push('measure');
        height.set(trigger.get() * 10);
      });
      effect(() => {
        trigger.get();
        order.push('user');
      });
      return d;
    });

    flushSync();
    order.length = 0;

    trigger.set(2);
    flushSync();
    // Publishing through a signal is the way out of a read-only phase: the
    // render effect that consumes it still lands before user work.
    expect(order).toEqual(['render', 'measure', 'apply:20', 'user']);
    dispose();
  });

  it('gives up on measures that keep dirtying each other', () => {
    const a = new Signal.State(0);
    const b = new Signal.State(0);
    let dispose = (): void => {};

    createRoot((d) => {
      dispose = d;
      measureEffect(() => a.set(b.get() + 1));
      measureEffect(() => b.set(a.get() + 1));
    });

    let thrown: unknown;
    try {
      flushSync();
    } catch (err) {
      thrown = err;
    } finally {
      // Disposed before the assertion runs: a pair still ping-ponging would
      // otherwise follow this test into every flush after it.
      dispose();
    }

    // The alternative to throwing is a hang, which is the worse one.
    expect(String(thrown)).toMatch(/Measure effects did not settle/);
  });
});

describe('the read-only contract', () => {
  function element(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }

  it('reports a measure callback that writes to the DOM', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = element();

    const dispose = createRoot((d) => {
      measureEffect(() => {
        el.style.top = '4px';
      });
      return d;
    });
    flushSync();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/measure effect wrote to the DOM \(style/);
    spy.mockRestore();
    dispose();
    el.remove();
  });

  it('names the kind of write, whichever path made it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = element();

    const dispose = createRoot((d) => {
      measureEffect(() => {
        el.textContent = 'written';
      });
      return d;
    });
    flushSync();

    expect(String(spy.mock.calls[0]?.[0])).toMatch(/childList on <div>/);
    spy.mockRestore();
    dispose();
    el.remove();
  });

  it('says nothing when a measure callback only reads', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = element();
    const widths: number[] = [];

    const dispose = createRoot((d) => {
      measureEffect(() => void widths.push(el.getBoundingClientRect().width));
      return d;
    });
    flushSync();

    expect(widths).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    dispose();
    el.remove();
  });

  it('reports a scroll position written back from a measure', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = element();

    const dispose = createRoot((d) => {
      measureEffect(() => {
        // Read the offset, write it back: no attribute changes, no child
        // moves, no text is touched, and it is the exact round trip the
        // phase exists to forbid.
        el.scrollTop = el.scrollTop + 10;
      });
      return d;
    });
    flushSync();

    expect(String(spy.mock.calls[0]?.[0])).toMatch(/scrollTop on <div>/);
    spy.mockRestore();
    dispose();
    el.remove();
  });

  it('reports a scroller moved by a method call', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = element();

    const dispose = createRoot((d) => {
      measureEffect(() => el.scrollIntoView());
      return d;
    });
    flushSync();

    expect(String(spy.mock.calls[0]?.[0])).toMatch(/scrollIntoView on <div>/);
    spy.mockRestore();
    dispose();
    el.remove();
  });

  it('says nothing about writes past the boundary it can see', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const input = document.createElement('input');
    document.body.appendChild(input);
    const detached = document.createElement('div');

    const dispose = createRoot((d) => {
      measureEffect(() => {
        // A property that changes no node, a method that moves focus rather
        // than a scroller, and a node the observer is not watching. None is
        // caught, and this test is what makes that a stated boundary rather
        // than a surprise found later.
        input.value = 'typed';
        input.focus();
        detached.setAttribute('data-x', '1');
      });
      return d;
    });
    flushSync();

    expect(spy).not.toHaveBeenCalled();
    // The writes themselves, so that a measure that never ran cannot pass this
    // by writing nothing — which is the shape every assertion for an absence
    // is one refactor away from becoming.
    expect(input.value).toBe('typed');
    expect(document.activeElement).toBe(input);
    expect(detached.getAttribute('data-x')).toBe('1');
    spy.mockRestore();
    dispose();
    input.blur();
    input.remove();
  });

  it('counts every write, rather than naming the first and dropping the rest', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = element();

    const dispose = createRoot((d) => {
      measureEffect(() => {
        el.setAttribute('data-a', '1');
        el.setAttribute('data-b', '2');
        el.setAttribute('data-c', '3');
      });
      return d;
    });
    flushSync();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/data-a on <div> and 2 more/);
    spy.mockRestore();
    dispose();
    el.remove();
  });

  it('does not blame the measure for a render effect created inside it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = element();

    const dispose = createRoot((d) => {
      measureEffect(() => {
        el.getBoundingClientRect();
        // Publishing through a render effect is the advice the guard prints.
        // Reporting the write it then makes was printing that advice at code
        // which had already taken it.
        renderEffect(() => el.setAttribute('data-applied', '1'));
      });
      return d;
    });
    flushSync();

    expect(spy).not.toHaveBeenCalled();
    expect(el.getAttribute('data-applied')).toBe('1');
    spy.mockRestore();
    dispose();
    el.remove();
  });

  it('still reports what the measure itself wrote around one it did not', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = element();

    const dispose = createRoot((d) => {
      measureEffect(() => {
        el.setAttribute('data-before', '1');
        renderEffect(() => el.setAttribute('data-applied', '1'));
        el.setAttribute('data-after', '1');
      });
      return d;
    });
    flushSync();

    // Two, not three: the nested effect's write is dropped and the writes
    // either side of it survive, which is what stops the suppression from
    // becoming a hole to hide a write in.
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/data-before on <div> and 1 more/);
    spy.mockRestore();
    dispose();
    el.remove();
  });

  it('polices the measure drain only, not the phases either side of it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = element();
    const source = new Signal.State(0);

    const dispose = createRoot((d) => {
      renderEffect(() => el.setAttribute('data-count', String(source.get())));
      measureEffect(() => void el.getBoundingClientRect());
      effect(() => {
        el.style.left = `${source.get()}px`;
      });
      return d;
    });
    flushSync();
    source.set(1);
    flushSync();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    dispose();
    el.remove();
  });
});

describe('effects created during a measure', () => {
  it('land in their own phase, in the same flush', () => {
    const order: string[] = [];

    const dispose = createRoot((d) => {
      measureEffect(() => {
        order.push('measure');
        renderEffect(() => void order.push('render:inner'));
        measureEffect(() => void order.push('measure:inner'));
        effect(() => void order.push('user:inner'));
      });
      effect(() => void order.push('user:outer'));
      return d;
    });

    flushSync();
    expect(order).toEqual([
      'measure',
      // A render effect still builds now — that is what makes a template
      // produce nodes — while the two deferred ones wait for their phase.
      'render:inner',
      'measure:inner',
      'user:outer',
      'user:inner',
    ]);
    dispose();
  });

  it('drains one a render effect created, still ahead of user work', () => {
    const order: string[] = [];

    const dispose = createRoot((d) => {
      // Declared first, and created first: a measure the render pass has not
      // made yet is behind it in every queue there is. Only the lane puts the
      // measurement in front, so writing these the other way round would let
      // this pass with no lane at all.
      effect(() => void order.push('user'));
      renderEffect(() => {
        order.push('render');
        measureEffect(() => void order.push('measure:from-render'));
      });
      return d;
    });

    flushSync();
    expect(order).toEqual(['render', 'measure:from-render', 'user']);
    dispose();
  });

  it('drains one a user effect created, in the same flush but behind it', () => {
    const order: string[] = [];

    const dispose = createRoot((d) => {
      effect(() => {
        order.push('user');
        measureEffect(() => void order.push('measure:from-user'));
      });
      return d;
    });

    flushSync();
    // The one place the lane's promise does not hold: the flush does go back
    // to the measure phase, but the user effect that asked for the
    // measurement has already run, so a write it made is ahead of the read.
    expect(order).toEqual(['user', 'measure:from-user']);
    dispose();
  });

  it('re-runs a nested measure in the measure phase, not at creation', () => {
    const source = new Signal.State(0);
    const order: string[] = [];

    const dispose = createRoot((d) => {
      measureEffect(() => {
        order.push('outer');
        measureEffect(() => void order.push(`inner:${source.get()}`));
      });
      effect(() => {
        source.get();
        order.push('user');
      });
      return d;
    });

    flushSync();
    expect(order).toEqual(['outer', 'inner:0', 'user']);

    order.length = 0;
    source.set(1);
    flushSync();
    // The outer measure did not depend on `source`, so only the nested one
    // re-runs — still ahead of the user effect.
    expect(order).toEqual(['inner:1', 'user']);
    dispose();
  });
});

describe('disposal during a flush', () => {
  it('skips a measure effect disposed earlier in the same drain', () => {
    const order: string[] = [];
    let disposeB = (): void => {};

    const dispose = createRoot((d) => {
      measureEffect(() => {
        order.push('a');
        disposeB();
      });
      disposeB = measureEffect(() => void order.push('b'));
      effect(() => void order.push('user'));
      return d;
    });

    expect(() => flushSync()).not.toThrow();
    expect(order).toEqual(['a', 'user']);
    dispose();
  });

  it('skips a measure effect a render effect disposed in the same flush', () => {
    const order: string[] = [];
    let disposeMeasure = (): void => {};

    const dispose = createRoot((d) => {
      disposeMeasure = measureEffect(() => void order.push('measure'));
      renderEffect(() => {
        order.push('render');
        disposeMeasure();
      });
      effect(() => void order.push('user'));
      return d;
    });

    expect(() => flushSync()).not.toThrow();
    expect(order).toEqual(['render', 'user']);
    dispose();
  });

  it('survives a scope disposing itself from inside the measure phase', () => {
    const order: string[] = [];

    createRoot((d) => {
      measureEffect(() => {
        order.push('measure');
        d();
      });
      effect(() => void order.push('user'));
    });

    expect(() => flushSync()).not.toThrow();
    expect(order).toEqual(['measure']);
  });

  it('keeps flushing after a measure callback throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order: string[] = [];

    const dispose = createRoot((d) => {
      measureEffect(() => {
        throw new Error('boom');
      });
      measureEffect(() => void order.push('measure'));
      effect(() => void order.push('user'));
      return d;
    });

    expect(() => flushSync()).not.toThrow();
    expect(order).toEqual(['measure', 'user']);
    spy.mockRestore();
    dispose();
  });
});

describe('forced-layout accounting', () => {
  it('collapses every read in a flush into one forced layout', () => {
    const source = new Signal.State(0);
    const elements = Array.from({ length: 20 }, () => {
      const el = document.createElement('div');
      document.body.appendChild(el);
      return el;
    });

    const dispose = createRoot((d) => {
      for (const el of elements) {
        renderEffect(() => el.setAttribute('data-count', String(source.get())));
        measureEffect(() => {
          source.get();
          el.getBoundingClientRect();
        });
      }
      return d;
    });
    flushSync();

    resetFlushMetrics();
    source.set(1);
    flushSync();

    // Twenty components that each write and then read: one layout, not twenty,
    // and not one geometry read outside the phase that pays for it.
    expect(getFlushMetrics()).toEqual({
      flushes: 1,
      forcedLayouts: 1,
      peakForcedLayouts: 1,
      strayReads: 0,
      peakStrayReads: 0,
    });
    dispose();
    for (const el of elements) el.remove();
  });

  it('counts the extra layout a re-measurement costs', () => {
    const trigger = new Signal.State(0);
    const measured = new Signal.State(0);

    const dispose = createRoot((d) => {
      renderEffect(() => void measured.get());
      measureEffect(() => measured.set(trigger.get()));
      measureEffect(() => void measured.get());
      return d;
    });
    flushSync();

    resetFlushMetrics();
    trigger.set(1);
    flushSync();

    // measure → render → measure again: the second read cannot reuse the
    // layout the first one paid for, and the number says so.
    expect(getFlushMetrics().forcedLayouts).toBe(2);
    expect(getFlushMetrics().peakForcedLayouts).toBe(2);
    dispose();
  });

  it('does not charge a second read pass that nothing wrote between', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const dispose = createRoot((d) => {
      measureEffect(() => {
        el.getBoundingClientRect();
        // Drains in a second measure pass — with no write in between, so the
        // layout the first pass forced is still good.
        measureEffect(() => void el.getBoundingClientRect());
      });
      return d;
    });

    resetFlushMetrics();
    flushSync();

    expect(getFlushMetrics().forcedLayouts).toBe(1);
    dispose();
    el.remove();
  });

  it('charges the re-measurement a user effect provokes', () => {
    const source = new Signal.State(0);
    const measured: number[] = [];

    const dispose = createRoot((d) => {
      measureEffect(() => void measured.push(source.get()));
      effect(() => {
        if (source.get() === 0) source.set(1);
      });
      return d;
    });

    resetFlushMetrics();
    flushSync();

    // A user effect writes, so the second read cannot trust the first read's
    // layout — the whole reason user work runs last.
    expect(measured).toEqual([0, 1]);
    expect(getFlushMetrics().forcedLayouts).toBe(2);
    dispose();
  });

  it('charges nothing to a flush that never reads', () => {
    const source = new Signal.State(0);
    const dispose = createRoot((d) => {
      renderEffect(() => void source.get());
      effect(() => void source.get());
      return d;
    });
    flushSync();

    resetFlushMetrics();
    source.set(1);
    flushSync();

    expect(getFlushMetrics()).toEqual({
      flushes: 1,
      forcedLayouts: 0,
      peakForcedLayouts: 0,
      strayReads: 0,
      peakStrayReads: 0,
    });
    dispose();
  });

  it('hands back a snapshot rather than the live counters', () => {
    const source = new Signal.State(0);
    const dispose = createRoot((d) => {
      measureEffect(() => void source.get());
      return d;
    });
    flushSync();

    resetFlushMetrics();
    source.set(1);
    flushSync();
    const first = getFlushMetrics();

    source.set(2);
    flushSync();

    // Aliasing the counters would answer the second flush to a reader that
    // asked about the first, and every assertion written against a held
    // reading would quietly become an assertion about the present.
    expect(first).toEqual({
      flushes: 1,
      forcedLayouts: 1,
      peakForcedLayouts: 1,
      strayReads: 0,
      peakStrayReads: 0,
    });
    expect(getFlushMetrics().flushes).toBe(2);
    dispose();
  });

  it('ignores a flush with nothing to drain, and keeps the peak', () => {
    const source = new Signal.State(0);
    const dispose = createRoot((d) => {
      measureEffect(() => void source.get());
      return d;
    });
    flushSync();

    resetFlushMetrics();
    source.set(1);
    flushSync();
    // An idle flush would otherwise overwrite the measurement with a zero.
    flushSync();

    expect(getFlushMetrics()).toEqual({
      flushes: 1,
      forcedLayouts: 1,
      peakForcedLayouts: 1,
      strayReads: 0,
      peakStrayReads: 0,
    });
    dispose();
  });
});

describe('reading from the wrong phase', () => {
  function element(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
  }

  it('counts what a user effect reads, where forcedLayouts cannot', () => {
    const source = new Signal.State(0);
    const el = element();

    const dispose = createRoot((d) => {
      renderEffect(() => el.setAttribute('data-count', String(source.get())));
      effect(() => {
        source.get();
        el.getBoundingClientRect();
      });
      return d;
    });
    flushSync();

    resetFlushMetrics();
    source.set(1);
    flushSync();

    // Write, then read from the phase that writes. The read never enters a
    // measure drain, so `forcedLayouts` reports the same zero it reports for a
    // flush that read nothing at all — which is why this second number exists.
    expect(getFlushMetrics().strayReads).toBe(1);
    expect(getFlushMetrics().forcedLayouts).toBe(0);
    dispose();
    el.remove();
  });

  it('counts what a render effect reads', () => {
    const source = new Signal.State(0);
    const el = element();

    const dispose = createRoot((d) => {
      renderEffect(() => {
        el.setAttribute('data-count', String(source.get()));
        el.getBoundingClientRect();
      });
      return d;
    });
    flushSync();

    resetFlushMetrics();
    source.set(1);
    flushSync();

    expect(getFlushMetrics().strayReads).toBe(1);
    dispose();
    el.remove();
  });

  it('climbs with the number of components measuring from the wrong phase', () => {
    const source = new Signal.State(0);
    const elements = Array.from({ length: 20 }, element);

    const dispose = createRoot((d) => {
      for (const el of elements) {
        renderEffect(() => el.setAttribute('data-count', String(source.get())));
        effect(() => {
          source.get();
          el.getBoundingClientRect();
        });
      }
      return d;
    });
    flushSync();

    resetFlushMetrics();
    source.set(1);
    flushSync();

    // The shape the documentation promises: a number that grows with the page
    // rather than one that stays flat while the page gets slower.
    expect(getFlushMetrics()).toEqual({
      flushes: 1,
      forcedLayouts: 0,
      peakForcedLayouts: 0,
      strayReads: 20,
      peakStrayReads: 20,
    });
    dispose();
    for (const el of elements) el.remove();
  });

  it('charges nothing for a read made between two flushes', () => {
    const source = new Signal.State(0);
    const el = element();

    const dispose = createRoot((d) => {
      effect(() => void source.get());
      return d;
    });
    flushSync();
    resetFlushMetrics();

    // An event handler and an animation frame both read from outside a flush.
    // They force layouts of their own, but they are not the scheduler's to
    // account for, and charging them to whichever flush came next would make
    // the number unreadable.
    el.getBoundingClientRect();
    source.set(1);
    flushSync();

    expect(getFlushMetrics().strayReads).toBe(0);
    dispose();
    el.remove();
  });
});
