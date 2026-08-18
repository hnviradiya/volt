/**
 * The data lane, and what a server flush leaves alone.
 *
 * `createResource` starts its first request from a deferred effect, so a
 * server that runs no effects fetches nothing and has nothing to wait for.
 * The lane is the way out of that: deferred like user work, drained like
 * render work, and the only other queue a server touches.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  Signal,
  createRoot,
  dataEffect,
  effect,
  flushSync,
  getFlushMetrics,
  measureEffect,
  renderEffect,
  resetFlushMetrics,
} from '../src/index.js';

/**
 * The build flag, which the test config compiles to a live read of this global
 * so one file can render both sides.
 */
function serverBuild(on: boolean): void {
  (globalThis as { __VOLT_SERVER__?: boolean }).__VOLT_SERVER__ = on;
}

afterEach(() => {
  serverBuild(false);
  flushSync();
});

describe('phase order', () => {
  it('drains data after render and before measure and user', () => {
    const source = new Signal.State(0);
    const order: string[] = [];

    createRoot(() => {
      effect(() => {
        source.get();
        order.push('user');
      });
      measureEffect(() => {
        source.get();
        order.push('measure');
      });
      dataEffect(() => {
        source.get();
        order.push('data');
      });
      renderEffect(() => {
        source.get();
        order.push('render');
      });
    });

    flushSync();
    order.length = 0;

    source.set(1);
    flushSync();

    expect(order).toEqual(['render', 'data', 'measure', 'user']);
  });

  it('costs the measure phase nothing, because it runs before it', () => {
    const source = new Signal.State(0);
    const answer = new Signal.State('none');

    createRoot(() => {
      renderEffect(() => {
        // Stands in for the DOM write a resource's status drives.
        answer.get();
      });
      dataEffect(() => {
        source.get();
        answer.set('some');
      });
      measureEffect(() => {
        answer.get();
      });
    });

    flushSync();
    resetFlushMetrics();

    source.set(1);
    answer.set('none');
    flushSync();

    // Drained after measure, the write above would dirty the layout that phase
    // had just paid for and the same flush would force a second one.
    expect(getFlushMetrics().forcedLayouts).toBe(1);
  });
});

describe('a server flush', () => {
  it('stops after the data lane', () => {
    serverBuild(true);
    const order: string[] = [];

    createRoot(() => {
      renderEffect(() => order.push('render'));
      dataEffect(() => order.push('data'));
      measureEffect(() => order.push('measure'));
      effect(() => order.push('user'));
    });

    flushSync();
    expect(order).toEqual(['render', 'data']);

    // The same effects, in a build that has a document: nothing was lost, it
    // was left where a client would find it.
    serverBuild(false);
    flushSync();
    expect(order).toEqual(['render', 'data', 'measure', 'user']);
  });

  it('is the only thing that flushes on a server', async () => {
    serverBuild(true);
    let runs = 0;

    createRoot(() => {
      dataEffect(() => {
        runs++;
      });
    });

    // A microtask is exactly what a queued flush would ride on, and exactly
    // what fires at a render's first `await` — under whatever request happens
    // to be current by then.
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(0);

    flushSync();
    expect(runs).toBe(1);
  });
});
