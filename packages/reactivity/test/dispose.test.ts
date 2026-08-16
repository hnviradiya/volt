import { describe, expect, it } from 'vitest';
import { Signal, createRoot, effect, flushSync } from '@voltdev/reactivity';

describe('disposal detaches from the graph', () => {
  it('a disposed effect leaves no sink behind', () => {
    const shared = new Signal.State(0);

    for (let i = 0; i < 100; i++) {
      const dispose = createRoot((d) => {
        effect(() => shared.get());
        return d;
      });
      flushSync();
      dispose();
    }

    // Without this, a long-lived signal accumulates dead nodes and every
    // write walks them.
    expect(Signal.subtle.introspectSinks(shared)).toHaveLength(0);
    expect(Signal.subtle.hasSinks(shared)).toBe(false);
  });

  it('surviving effects keep working after a sibling is disposed', () => {
    const shared = new Signal.State(0);
    const seen: number[] = [];

    const disposeA = createRoot((d) => {
      effect(() => void shared.get());
      return d;
    });
    createRoot(() => {
      effect(() => void seen.push(shared.get()));
    });
    flushSync();

    disposeA();
    shared.set(1);
    flushSync();

    expect(seen).toEqual([0, 1]);
    expect(Signal.subtle.introspectSinks(shared)).toHaveLength(1);
  });

  it('disposing a scope detaches every effect it owns', () => {
    const a = new Signal.State(0);
    const b = new Signal.State(0);

    const dispose = createRoot((d) => {
      effect(() => void a.get());
      effect(() => void b.get());
      return d;
    });
    flushSync();
    expect(Signal.subtle.hasSinks(a)).toBe(true);

    dispose();
    expect(Signal.subtle.hasSinks(a)).toBe(false);
    expect(Signal.subtle.hasSinks(b)).toBe(false);
  });
});
