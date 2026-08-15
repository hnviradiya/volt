/**
 * Lazy components — code splitting.
 *
 * A lazy component renders as an accessor, so the placeholder, the loaded
 * component and a failed load all travel the same reactive path any changing
 * value would. Nothing about the compiler or the insertion machinery knows
 * this feature exists.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compileTemplate } from '@voltjs/core/jit';
import { Component, Prop, Signal, flushSync, mount } from '@voltjs/core';
// Not part of the public API: the build decides what to split, and emits
// these itself. Reached here through the entry compiled output uses.
import { lazy, preload } from '@voltjs/core/runtime';

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector('#app')!;
});

@Component({ selector: 'v-real', render: compileTemplate(`<span>loaded {{ label }}</span>`) })
class Real {
  @Prop() label = '';
}

/** A loader resolved by hand, so the pending state can be observed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('loading', () => {
  it('shows the fallback, then the component', async () => {
    const gate = deferred<{ default: typeof Real }>();
    const Lazy = lazy('v-real', () => gate.promise, { fallback: () => 'loading…' });

    @Component({
      selector: 'v-page',
      imports: [Lazy],
      render: compileTemplate(`<div><v-real label="x"></v-real></div>`),
    })
    class Page {}

    mount(Page, host);
    expect(host.textContent).toBe('loading…');

    gate.resolve({ default: Real });
    await preload(Lazy);
    flushSync();
    expect(host.textContent).toBe('loaded x');
  });

  it('accepts a loader that returns the class directly', async () => {
    const Lazy = lazy('v-real', async () => Real);

    @Component({
      selector: 'v-page2',
      imports: [Lazy],
      render: compileTemplate(`<div><v-real label="y"></v-real></div>`),
    })
    class Page {}

    mount(Page, host);
    await preload(Lazy);
    flushSync();
    expect(host.textContent).toBe('loaded y');
  });

  it('renders nothing while loading when no fallback is given', () => {
    const gate = deferred<{ default: typeof Real }>();
    const Lazy = lazy('v-real', () => gate.promise);

    @Component({
      selector: 'v-page3',
      imports: [Lazy],
      render: compileTemplate(`<div><v-real label="z"></v-real></div>`),
    })
    class Page {}

    mount(Page, host);
    expect(host.textContent).toBe('');
  });

  it('loads once however many instances are rendered', async () => {
    const loader = vi.fn(async () => Real);
    const Lazy = lazy('v-real', loader);

    @Component({
      selector: 'v-page4',
      imports: [Lazy],
      render: compileTemplate(
        `<div><v-real label="a"></v-real><v-real label="b"></v-real></div>`,
      ),
    })
    class Page {}

    mount(Page, host);
    await preload(Lazy);
    flushSync();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe('loaded aloaded b');
  });
});

describe('preloading', () => {
  it('fetches ahead of render, so the component is there on first paint', async () => {
    const loader = vi.fn(async () => Real);
    const Lazy = lazy('v-real', loader);

    await preload(Lazy);
    expect(loader).toHaveBeenCalledTimes(1);

    @Component({
      selector: 'v-page5',
      imports: [Lazy],
      render: compileTemplate(`<div><v-real label="q"></v-real></div>`),
    })
    class Page {}

    mount(Page, host);
    flushSync();
    // Already resolved, so no fallback frame is shown at all.
    expect(host.textContent).toBe('loaded q');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('is harmless on a component that is not lazy', async () => {
    await expect(preload(Real)).resolves.toBeUndefined();
  });
});

describe('failure', () => {
  it('renders the error fallback and can retry', async () => {
    let attempt = 0;
    const Lazy = lazy(
      'v-real',
      async () => {
        attempt += 1;
        // A chunk removed by a deploy is the usual cause, and it succeeds on
        // reload — so retry has to actually re-run the loader.
        if (attempt === 1) throw new Error('chunk gone');
        return Real;
      },
      {
        fallback: () => 'loading…',
        error: (_err, retry) => {
          retries.push(retry);
          return 'failed';
        },
      },
    );
    const retries: (() => void)[] = [];

    @Component({
      selector: 'v-page6',
      imports: [Lazy],
      render: compileTemplate(`<div><v-real label="r"></v-real></div>`),
    })
    class Page {}

    mount(Page, host);
    await preload(Lazy);
    flushSync();
    expect(host.textContent).toBe('failed');

    retries[retries.length - 1]!();
    await preload(Lazy);
    flushSync();
    expect(host.textContent).toBe('loaded r');
    expect(attempt).toBe(2);
  });

  it('renders nothing on failure when no error fallback is given', async () => {
    const Lazy = lazy('v-real', async () => {
      throw new Error('nope');
    });

    @Component({
      selector: 'v-page7',
      imports: [Lazy],
      render: compileTemplate(`<div><v-real label="s"></v-real></div>`),
    })
    class Page {}

    mount(Page, host);
    await preload(Lazy);
    flushSync();
    expect(host.textContent).toBe('');
  });
});

describe('props and reactivity', () => {
  it('passes reactive props through to the loaded component', async () => {
    @Component({
      selector: 'v-live',
      render: compileTemplate(`<span>{{ n.get() }}</span>`),
    })
    class Live {
      @Prop() n = new Signal.State(0);
    }

    const Lazy = lazy('v-live', async () => Live);

    @Component({
      selector: 'v-page8',
      imports: [Lazy],
      render: compileTemplate(`<div><v-live :n="count.get()"></v-live></div>`),
    })
    class Page {
      count = new Signal.State(1);
    }

    const handle = mount(Page, host);
    await preload(Lazy);
    flushSync();
    expect(host.textContent).toBe('1');

    (handle.instance as Page).count.set(5);
    flushSync();
    expect(host.textContent).toBe('5');
  });
});
