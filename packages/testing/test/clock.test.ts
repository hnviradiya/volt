/**
 * The fake clock, and the reason it is fussy about what it fakes.
 *
 * The headline case is at the bottom: a `createResource` debounce advanced by
 * fake timers, with the DOM keeping up the whole way. That combination is what
 * broke the first time — a fake timer implementation that also replaced
 * `queueMicrotask` stopped Volt's scheduler dead, so the timer fired, the
 * signal was written, and nothing rendered. The failure looked like a bug in
 * the resource.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, Signal, effect, flushSync, tick } from '@voltdev/core';
import { compileTemplate } from '@voltdev/core/jit';
import { createResource } from '@voltdev/primitives';
import { installClock, type FakeClock } from '../src/clock.ts';
import { cleanup, render } from '../src/render.ts';
import { settle } from '../src/scheduler.ts';
import { typeText } from '../src/interact.ts';

let clock: FakeClock | null = null;

const install = (now?: number): FakeClock => {
  clock = installClock(now === undefined ? {} : { now });
  return clock;
};

afterEach(() => {
  clock?.uninstall();
  clock = null;
  cleanup();
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// What it fakes, and what it must not
// ---------------------------------------------------------------------------

describe('what the clock leaves alone', () => {
  it('never replaces the microtask queue', () => {
    const realMicrotask = globalThis.queueMicrotask;
    const realPromise = globalThis.Promise;

    install();

    // Pinned deliberately. Every general-purpose fake-timer library offers to
    // fake these, and taking the offer is what stops Volt rendering at all —
    // silently, because the scheduler simply never gets its turn.
    expect(globalThis.queueMicrotask).toBe(realMicrotask);
    expect(globalThis.Promise).toBe(realPromise);
  });

  it('lets the scheduler settle on its own', async () => {
    install();
    const n = new Signal.State(0);
    const seen: number[] = [];
    const stop = effect(() => void seen.push(n.get()));

    // No `flushSync` anywhere: `tick()` waits for the scheduler's own
    // microtask, which is the call that hangs forever — rather than failing —
    // once the microtask queue is faked. The first run of a user effect is
    // deferred, so the first tick is already doing work.
    await tick();
    expect(seen).toEqual([0]);

    n.set(1);
    await tick();
    expect(seen).toEqual([0, 1]);
    stop();
  });

  it('keeps effects flushing while it is installed', async () => {
    const clock = install();
    const n = new Signal.State(0);
    const seen: number[] = [];
    const stop = effect(() => void seen.push(n.get()));
    flushSync();

    setTimeout(() => n.set(1), 50);
    await clock.advance(50);

    expect(seen).toEqual([0, 1]);
    stop();
  });
});

describe('installing', () => {
  it('puts every primitive it faked back', () => {
    const real = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      dateNow: Date.now,
      performanceNow: performance.now,
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
    };

    const clock = install();
    expect(globalThis.setTimeout).not.toBe(real.setTimeout);
    expect(Date.now).not.toBe(real.dateNow);

    clock.uninstall();

    // Every one of them, identity by identity. A fake left behind does not
    // fail here — it fails in whatever test runs next, as a date that never
    // moves or a frame that never arrives.
    expect(globalThis.setTimeout).toBe(real.setTimeout);
    expect(globalThis.clearTimeout).toBe(real.clearTimeout);
    expect(globalThis.setInterval).toBe(real.setInterval);
    expect(globalThis.clearInterval).toBe(real.clearInterval);
    expect(Date.now).toBe(real.dateNow);
    expect(performance.now).toBe(real.performanceNow);
    expect(globalThis.requestAnimationFrame).toBe(real.requestAnimationFrame);
    expect(globalThis.cancelAnimationFrame).toBe(real.cancelAnimationFrame);
  });

  it('refuses a second clock rather than splitting the timers between two', () => {
    install();
    expect(() => installClock()).toThrow(/already installed/);
  });

  it('does not mind being uninstalled twice', () => {
    const clock = install();
    clock.uninstall();
    expect(() => clock.uninstall()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

describe('time', () => {
  it('starts where it is told and moves only when advanced', async () => {
    const clock = install(1_700_000_000_000);
    expect(Date.now()).toBe(1_700_000_000_000);
    expect(clock.now()).toBe(1_700_000_000_000);

    await clock.advance(1_500);
    expect(Date.now()).toBe(1_700_000_001_500);
  });

  it('lands on the requested time even when the last timer fired earlier', async () => {
    const clock = install(0);
    setTimeout(() => {}, 10);

    await clock.advance(100);
    await clock.advance(100);

    // Two advances of 100 have to be the same as one of 200, or a test that
    // steps through a sequence drifts.
    expect(clock.now()).toBe(200);
  });

  it('moves performance.now with it, so elapsed time agrees with the wall clock', async () => {
    const clock = install();
    const before = performance.now();
    await clock.advance(250);
    expect(performance.now() - before).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// Running timers
// ---------------------------------------------------------------------------

describe('advance', () => {
  it('runs what is due and leaves what is not', async () => {
    const clock = install(0);
    const ran: string[] = [];
    setTimeout(() => ran.push('late'), 100);
    setTimeout(() => ran.push('early'), 10);

    await clock.advance(10);
    expect(ran).toEqual(['early']);
    expect(clock.pending()).toBe(1);

    await clock.advance(90);
    expect(ran).toEqual(['early', 'late']);
    expect(clock.pending()).toBe(0);
  });

  it('runs timers in time order, and ties in the order they were scheduled', async () => {
    const clock = install(0);
    const ran: string[] = [];
    setTimeout(() => ran.push('a'), 5);
    setTimeout(() => ran.push('b'), 5);
    setTimeout(() => ran.push('c'), 1);

    await clock.advance(10);
    expect(ran).toEqual(['c', 'a', 'b']);
  });

  it('runs a timer scheduled by another timer inside the same window', async () => {
    const clock = install(0);
    const ran: number[] = [];
    setTimeout(() => {
      ran.push(clock.now());
      setTimeout(() => ran.push(clock.now()), 30);
    }, 10);

    await clock.advance(50);
    expect(ran).toEqual([10, 40]);
  });

  it('lets a promise chain started by a timer finish', async () => {
    const clock = install(0);
    const ran: string[] = [];
    setTimeout(() => {
      void Promise.resolve().then(() => ran.push('then'));
    }, 10);

    await clock.advance(10);

    // The microtask checkpoint a browser reaches at the end of every task. An
    // `await` in a fetcher is this, and without it the work a resolved promise
    // unblocks would sit until the test happened to await something else.
    expect(ran).toEqual(['then']);
  });

  it('settles work already in flight when no timer is due at all', async () => {
    const clock = install(0);
    const n = new Signal.State(0);
    const seen: number[] = [];
    const stop = effect(() => void seen.push(n.get()));
    flushSync();

    // A fetcher that awaits a response and then its body is two turns deep,
    // and nothing here is on the clock: `drain` runs no timer and so reaches
    // no checkpoint, which leaves the one at the end of `advance` as the only
    // thing standing between an awaiting component and an assertion about a
    // tree that never updated.
    void (async () => {
      await Promise.resolve();
      await Promise.resolve();
      n.set(1);
    })();

    await clock.advance(0);

    expect(seen).toEqual([0, 1]);
    stop();
  });

  it('lets a promise resolved by one timer schedule the next, inside the same window', async () => {
    const clock = install(0);
    const ran: number[] = [];
    setTimeout(() => {
      void Promise.resolve().then(() => {
        setTimeout(() => ran.push(clock.now()), 10);
      });
    }, 10);

    await clock.advance(50);

    // This is what "cooperates with the scheduler" costs: a microtask
    // checkpoint after *each* callback rather than one at the end of the
    // advance. Settling only at the end would leave the `.then` to run after
    // the window had closed, and the second timer pending at a time already
    // passed — which is how an awaiting fetcher's follow-up work silently
    // fails to happen.
    expect(ran).toEqual([20]);
    expect(clock.pending()).toBe(0);
  });

  it('cancels a cleared timeout', async () => {
    const clock = install(0);
    const ran = vi.fn();
    const id = setTimeout(ran, 10);
    clearTimeout(id);

    expect(clock.pending()).toBe(0);
    await clock.advance(100);
    expect(ran).not.toHaveBeenCalled();
  });

  it('repeats an interval until it is cleared', async () => {
    const clock = install(0);
    let ticks = 0;
    const id = setInterval(() => ticks++, 10);

    await clock.advance(35);
    expect(ticks).toBe(3);

    clearInterval(id);
    await clock.advance(100);
    expect(ticks).toBe(3);
  });

  it('runs animation frames', async () => {
    const clock = install(0);
    const frames: number[] = [];
    requestAnimationFrame((t) => frames.push(t));

    await clock.advance(16);
    expect(frames).toEqual([16]);
  });

  it('runs everything left when asked to', async () => {
    const clock = install(0);
    const ran: string[] = [];
    setTimeout(() => ran.push('a'), 10);
    setTimeout(() => ran.push('b'), 10_000);

    await clock.runAll();

    expect(ran).toEqual(['a', 'b']);
    expect(clock.pending()).toBe(0);
  });

  it('throws rather than hanging on a timer that reschedules itself forever', async () => {
    const clock = install(0);
    const tick = (): void => {
      setTimeout(tick, 0);
    };
    tick();

    await expect(clock.runAll()).rejects.toThrow(/rescheduling itself/);
  });
});

describe('pending', () => {
  it('shows a timer a component never cleared', async () => {
    @Component({
      selector: 'v-leaky-timer',
      render: compileTemplate('<p>{ n.get() }</p>'),
    })
    class LeakyTimer {
      n = new Signal.State(0);
      watcher = effect(() => {
        this.n.get();
        // No `onCleanup`, so unmounting leaves it armed — invisible in the
        // DOM, and the reason this count is exposed at all.
        setTimeout(() => this.n.set(1), 1_000);
      });
    }

    const clock = install(0);
    const view = render(LeakyTimer);
    expect(clock.pending()).toBe(1);

    view.unmount();
    await settle();

    expect(view.leakedEffects()).toBe(0);
    expect(clock.pending()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The case this exists for
// ---------------------------------------------------------------------------

@Component({
  selector: 'v-debounced-search',
  render: compileTemplate(`
    <div>
      <input aria-label="Search"
             :value="query.get()"
             :input="query.set($event.target.value)">
      <p role="status">{ results.status() }</p>
      <ul>
        <li :for="item of results.data() ?? []" :key="item">{ item }</li>
      </ul>
    </div>
  `),
})
class DebouncedSearch {
  query = new Signal.State('');
  /** Every query the fetcher was actually asked for. */
  asked: string[] = [];

  results = createResource<string[], string>(
    async ({ source }) => {
      this.asked.push(source);
      return [`${source} one`, `${source} two`];
    },
    {
      source: () => this.query.get(),
      enabled: () => this.query.get().length > 0,
      debounce: 200,
    },
  );
}

describe('a debounce, advanced', () => {
  it('waits the full delay, then renders the result', async () => {
    const clock = install(0);
    const view = render(DebouncedSearch);
    const field = view.getByRole('textbox', { name: 'Search' });

    typeText(field, 'cat');
    await settle();

    // Typed but not yet asked for: the debounce is holding it.
    expect(view.instance.asked).toEqual([]);
    expect(view.getByRole('status').textContent).toBe('idle');

    await clock.advance(199);
    expect(view.instance.asked).toEqual([]);

    await clock.advance(1);

    // The whole point, in three assertions: the timer fired, the fetcher ran,
    // and the DOM caught up — an await chain and an effect flush deep, with
    // nothing flushed by hand anywhere in this test. That the queue those
    // awaits run on is the real one is pinned separately, by 'lets the
    // scheduler settle on its own'; this asserts the end state a test author
    // actually writes.
    expect(view.instance.asked).toEqual(['cat']);
    expect(view.getByRole('status').textContent).toBe('success');
    expect(view.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'cat one',
      'cat two',
    ]);
  });

  it('asks once for a query the user was still typing', async () => {
    const clock = install(0);
    const view = render(DebouncedSearch);
    const field = view.getByRole('textbox', { name: 'Search' });

    typeText(field, 'ca');
    await clock.advance(150);
    typeText(field, 't');
    await clock.advance(150);

    // 300ms of fake time has passed, but never 200 without a keystroke.
    expect(view.instance.asked).toEqual([]);

    await clock.advance(50);
    expect(view.instance.asked).toEqual(['cat']);
  });

  it('leaves nothing running once the component is gone', async () => {
    const clock = install(0);
    const view = render(DebouncedSearch);
    typeText(view.getByRole('textbox', { name: 'Search' }), 'cat');

    view.unmount();
    await clock.runAll();

    expect(view.instance.asked).toEqual([]);
    expect(view.leakedEffects()).toBe(0);
  });
});
