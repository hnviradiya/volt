import { describe, expect, it, vi } from 'vitest';
import {
  Signal,
  batch,
  createRoot,
  effect,
  flushSync,
  onCleanup,
  renderEffect,
  tick,
  createContext,
  provideContext,
  useContext,
} from '@voltdev/reactivity';

describe('Signal.State', () => {
  it('reads and writes', () => {
    const count = new Signal.State(0);
    expect(count.get()).toBe(0);
    count.set(5);
    expect(count.get()).toBe(5);
  });

  it('ignores writes that compare equal', () => {
    const count = new Signal.State(1);
    const compute = vi.fn(() => count.get() * 2);
    const doubled = new Signal.Computed(compute);

    expect(doubled.get()).toBe(2);
    count.set(1);
    expect(doubled.get()).toBe(2);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('honours a custom equals', () => {
    const point = new Signal.State(
      { x: 0 },
      { equals: (a, b) => a.x === b.x },
    );
    const spy = vi.fn(() => point.get().x);
    const derived = new Signal.Computed(spy);

    expect(derived.get()).toBe(0);
    point.set({ x: 0 });
    expect(derived.get()).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);

    point.set({ x: 1 });
    expect(derived.get()).toBe(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('uses Object.is semantics by default', () => {
    const value = new Signal.State<number>(Number.NaN);
    const spy = vi.fn(() => value.get());
    const derived = new Signal.Computed(spy);

    derived.get();
    value.set(Number.NaN);
    derived.get();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('Signal.Computed', () => {
  it('is lazy — it does not run until read', () => {
    const spy = vi.fn(() => 42);
    const derived = new Signal.Computed(spy);
    expect(spy).not.toHaveBeenCalled();
    expect(derived.get()).toBe(42);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('memoizes until a dependency actually changes', () => {
    const a = new Signal.State(1);
    const spy = vi.fn(() => a.get() + 1);
    const derived = new Signal.Computed(spy);

    expect(derived.get()).toBe(2);
    expect(derived.get()).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);

    a.set(2);
    expect(derived.get()).toBe(3);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('evaluates a diamond exactly once per change', () => {
    const source = new Signal.State(1);
    const left = new Signal.Computed(() => source.get() * 2);
    const right = new Signal.Computed(() => source.get() * 3);
    const spy = vi.fn(() => left.get() + right.get());
    const bottom = new Signal.Computed(spy);

    expect(bottom.get()).toBe(5);
    expect(spy).toHaveBeenCalledTimes(1);

    source.set(2);
    expect(bottom.get()).toBe(10);
    // The join re-runs once, not once per path.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not re-run downstream when an intermediate value is unchanged', () => {
    const source = new Signal.State(2);
    const isEven = new Signal.Computed(() => source.get() % 2 === 0);
    const spy = vi.fn(() => (isEven.get() ? 'even' : 'odd'));
    const label = new Signal.Computed(spy);

    expect(label.get()).toBe('even');
    expect(spy).toHaveBeenCalledTimes(1);

    // 2 -> 4 changes the source but not `isEven`, so `label` must not re-run.
    source.set(4);
    expect(label.get()).toBe('even');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('caches thrown errors like values', () => {
    const shouldThrow = new Signal.State(true);
    const spy = vi.fn(() => {
      if (shouldThrow.get()) throw new Error('boom');
      return 'ok';
    });
    const derived = new Signal.Computed(spy);

    expect(() => derived.get()).toThrow('boom');
    expect(() => derived.get()).toThrow('boom');
    expect(spy).toHaveBeenCalledTimes(1);

    shouldThrow.set(false);
    expect(derived.get()).toBe('ok');
  });

  it('detects cycles', () => {
    const a: Signal.Computed<number> = new Signal.Computed(() => a.get() + 1);
    expect(() => a.get()).toThrow(/Cycle detected/);
  });

  it('refuses to write state from inside a computed', () => {
    const target = new Signal.State(0);
    const bad = new Signal.Computed(() => {
      target.set(1);
      return 0;
    });
    expect(() => bad.get()).toThrow(/must not write/);
  });

  it('tracks dependencies dynamically', () => {
    const useA = new Signal.State(true);
    const a = new Signal.State('a');
    const b = new Signal.State('b');
    const spy = vi.fn(() => (useA.get() ? a.get() : b.get()));
    const derived = new Signal.Computed(spy);

    expect(derived.get()).toBe('a');
    // `b` is not a dependency while the branch is not taken.
    b.set('b2');
    expect(derived.get()).toBe('a');
    expect(spy).toHaveBeenCalledTimes(1);

    useA.set(false);
    expect(derived.get()).toBe('b2');
  });
});

describe('Signal.subtle', () => {
  it('untrack prevents dependency collection', () => {
    const tracked = new Signal.State(1);
    const hidden = new Signal.State(10);
    const spy = vi.fn(() => tracked.get() + Signal.subtle.untrack(() => hidden.get()));
    const derived = new Signal.Computed(spy);

    expect(derived.get()).toBe(11);
    hidden.set(20);
    expect(derived.get()).toBe(11);
    expect(spy).toHaveBeenCalledTimes(1);

    tracked.set(2);
    expect(derived.get()).toBe(22);
  });

  it('exposes the currently evaluating computed', () => {
    expect(Signal.subtle.currentComputed()).toBeNull();
    let seen: unknown = 'unset';
    const derived = new Signal.Computed(() => {
      seen = Signal.subtle.currentComputed();
      return 1;
    });
    derived.get();
    expect(seen).toBe(derived);
  });

  it('introspects sources and sinks', () => {
    const a = new Signal.State(1);
    const derived = new Signal.Computed(() => a.get());
    expect(Signal.subtle.hasSources(derived)).toBe(false);
    derived.get();
    expect(Signal.subtle.introspectSources(derived)).toContain(a);
    expect(Signal.subtle.introspectSinks(a)).toContain(derived);
    expect(Signal.subtle.hasSinks(a)).toBe(true);
  });

  it('notifies a Watcher synchronously during set, then needs re-arming', () => {
    const source = new Signal.State(1);
    const derived = new Signal.Computed(() => source.get() * 2);
    const notify = vi.fn();

    const watcher = new Signal.subtle.Watcher(notify);
    watcher.watch(derived);
    derived.get();

    expect(notify).not.toHaveBeenCalled();
    source.set(2);
    expect(notify).toHaveBeenCalledTimes(1);

    // Still notified — no second call until the watcher is re-armed.
    source.set(3);
    expect(notify).toHaveBeenCalledTimes(1);

    expect(watcher.getPending()).toContain(derived);
    for (const pending of watcher.getPending()) pending.get();
    watcher.watch();

    source.set(4);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('fires watched/unwatched on observation transitions', () => {
    const onWatched = vi.fn();
    const onUnwatched = vi.fn();
    const source = new Signal.State(0, {
      [Signal.subtle.watched]: onWatched,
      [Signal.subtle.unwatched]: onUnwatched,
    });

    const derived = new Signal.Computed(() => source.get());
    const watcher = new Signal.subtle.Watcher(() => {});

    expect(onWatched).not.toHaveBeenCalled();
    watcher.watch(derived);
    derived.get();
    expect(onWatched).toHaveBeenCalledTimes(1);

    watcher.unwatch(derived);
    expect(onUnwatched).toHaveBeenCalledTimes(1);
  });
});

describe('effects', () => {
  it('runs on the first flush, then again on change', async () => {
    const count = new Signal.State(0);
    const seen: number[] = [];

    const dispose = createRoot((d) => {
      effect(() => {
        seen.push(count.get());
      });
      return d;
    });

    // Deferred: nothing has run yet.
    expect(seen).toEqual([]);
    flushSync();
    expect(seen).toEqual([0]);

    count.set(1);
    await tick();
    expect(seen).toEqual([0, 1]);
    dispose();
  });

  it('sees values assigned after the effect was created', () => {
    // The reason the first run is deferred: an effect declared alongside
    // state it depends on must not fire against a placeholder.
    const value = new Signal.State('placeholder');
    const seen: string[] = [];

    createRoot(() => {
      effect(() => void seen.push(value.get()));
      // Stands in for a component prop applied after construction.
      value.set('real');
    });

    flushSync();
    expect(seen).toEqual(['real']);
  });

  it('coalesces a burst of writes into one run', async () => {
    const count = new Signal.State(0);
    const spy = vi.fn(() => count.get());

    createRoot(() => {
      effect(spy);
    });
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);

    count.set(1);
    count.set(2);
    count.set(3);
    await tick();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(count.get()).toBe(3);
  });

  it('flushSync applies pending work immediately', () => {
    const count = new Signal.State(0);
    const seen: number[] = [];
    createRoot(() => {
      effect(() => void seen.push(count.get()));
    });

    flushSync();
    expect(seen).toEqual([0]);

    count.set(1);
    expect(seen).toEqual([0]);
    flushSync();
    expect(seen).toEqual([0, 1]);
  });

  it('runs render effects before user effects', () => {
    const source = new Signal.State(0);
    const order: string[] = [];

    createRoot(() => {
      renderEffect(() => {
        source.get();
        order.push('render');
      });
      effect(() => {
        source.get();
        order.push('user');
      });
    });

    flushSync();
    order.length = 0;
    source.set(1);
    flushSync();
    expect(order).toEqual(['render', 'user']);
  });

  it('a render effect runs immediately, because a template must build now', () => {
    const order: string[] = [];
    createRoot(() => {
      renderEffect(() => void order.push('render'));
      effect(() => void order.push('user'));
      // Only the render effect has run at this point.
      expect(order).toEqual(['render']);
    });
    flushSync();
    expect(order).toEqual(['render', 'user']);
  });

  it('runs the returned cleanup before each re-run and on dispose', async () => {
    const count = new Signal.State(0);
    const cleanups: number[] = [];
    let dispose = () => {};

    createRoot(() => {
      dispose = effect(() => {
        const value = count.get();
        return () => cleanups.push(value);
      });
    });
    flushSync();

    expect(cleanups).toEqual([]);
    count.set(1);
    await tick();
    expect(cleanups).toEqual([0]);

    dispose();
    expect(cleanups).toEqual([0, 1]);
  });

  it('onCleanup fires when the owning scope is disposed', () => {
    const cleaned = vi.fn();
    const dispose = createRoot((d) => {
      onCleanup(cleaned);
      return d;
    });

    expect(cleaned).not.toHaveBeenCalled();
    dispose();
    expect(cleaned).toHaveBeenCalledTimes(1);
  });

  it('disposing a root stops its effects', async () => {
    const count = new Signal.State(0);
    const spy = vi.fn(() => count.get());

    const dispose = createRoot((d) => {
      effect(spy);
      return d;
    });
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);

    dispose();
    count.set(1);
    await tick();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a root disposed before the first flush never runs its effect', () => {
    const spy = vi.fn();
    const dispose = createRoot((d) => {
      effect(spy);
      return d;
    });

    dispose();
    flushSync();
    expect(spy).not.toHaveBeenCalled();
  });

  it('disposes nested effects with their parent', async () => {
    const outer = new Signal.State(0);
    const inner = new Signal.State(0);
    const innerSpy = vi.fn(() => inner.get());

    const dispose = createRoot((d) => {
      effect(() => {
        outer.get();
        effect(innerSpy);
      });
      return d;
    });
    flushSync();
    expect(innerSpy).toHaveBeenCalledTimes(1);

    outer.set(1);
    await tick();
    expect(innerSpy).toHaveBeenCalledTimes(2);

    inner.set(1);
    await tick();
    expect(innerSpy).toHaveBeenCalledTimes(3);

    dispose();
    inner.set(2);
    await tick();
    expect(innerSpy).toHaveBeenCalledTimes(3);
  });

  it('lets an effect write signals', async () => {
    const source = new Signal.State(1);
    const mirror = new Signal.State(0);

    createRoot(() => {
      effect(() => mirror.set(source.get() * 10));
    });
    flushSync();

    expect(mirror.get()).toBe(10);
    source.set(2);
    await tick();
    expect(mirror.get()).toBe(20);
  });

  it('batch defers flushing until the group completes', () => {
    const a = new Signal.State(0);
    const b = new Signal.State(0);
    const spy = vi.fn(() => a.get() + b.get());

    createRoot(() => {
      effect(spy);
    });
    flushSync();
    expect(spy).toHaveBeenCalledTimes(1);

    batch(() => {
      a.set(1);
      b.set(2);
      flushSync();
      // Nothing has flushed yet — the batch is still open.
      expect(spy).toHaveBeenCalledTimes(1);
    });

    flushSync();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('context', () => {
  it('resolves through the scope chain and falls back to the default', () => {
    const Theme = createContext('light');
    let inner: string | undefined;
    let outside: string | undefined;

    createRoot(() => {
      provideContext(Theme, 'dark');
      createRoot(() => {
        inner = useContext(Theme);
      });
    });

    createRoot(() => {
      outside = useContext(Theme);
    });

    expect(inner).toBe('dark');
    expect(outside).toBe('light');
  });
});
