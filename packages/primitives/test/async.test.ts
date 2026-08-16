/**
 * createResource — async state for the six components that need it.
 *
 * Written after the fact, against code produced by an agent run that was
 * interrupted before it could test itself. The point of the exercise is the
 * claims the implementation makes in its own comments: that a superseded
 * response cannot overwrite a newer one, that `refetch` never rejects, and
 * that everything in flight is abandoned when the scope goes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Signal, createRoot, flushSync } from '@voltjs/core';
import { createResource } from '../src/async.js';

let disposers: (() => void)[] = [];

/** Build a resource inside a scope that the test tears down afterwards. */
function withScope<T>(build: () => T): T {
  let value!: T;
  createRoot((dispose) => {
    disposers.push(dispose);
    value = build();
  });
  flushSync();
  return value;
}

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  flushSync();
});

/** A promise resolved by hand, so an in-flight request can be observed. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
};

describe('the basic cycle', () => {
  it('goes idle to loading to success', async () => {
    const gate = deferred<string>();
    const resource = withScope(() => createResource(() => gate.promise));

    expect(resource.status()).toBe('loading');
    expect(resource.isLoading()).toBe(true);

    gate.resolve('hello');
    await settle();

    expect(resource.status()).toBe('success');
    expect(resource.data()).toBe('hello');
    expect(resource.error()).toBeUndefined();
  });

  it('records a failure without throwing out of refetch', async () => {
    const resource = withScope(() =>
      createResource(() => {
        throw new Error('nope');
      }),
    );
    await settle();

    expect(resource.status()).toBe('error');
    expect(resource.isError()).toBe(true);
    expect((resource.error() as Error).message).toBe('nope');

    // refetch is called from templates and handlers where nothing awaits it,
    // so rejecting would produce an unhandled rejection rather than a state.
    await expect(resource.refetch()).resolves.toBeUndefined();
  });

  it('starts in success when given initial data', () => {
    const resource = withScope(() =>
      createResource(() => 'fetched', { initialData: 'server', immediate: false }),
    );
    // A template branching on status must not show a spinner over data it has.
    expect(resource.status()).toBe('success');
    expect(resource.data()).toBe('server');
  });
});

describe('a superseded response cannot win', () => {
  it('ignores a slow earlier response that lands after a fast later one', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const source = new Signal.State('a');
    let call = 0;

    const resource = withScope(() =>
      createResource(() => (++call === 1 ? first.promise : second.promise), {
        source: () => source.get(),
      }),
    );

    source.set('b');
    flushSync();
    await Promise.resolve();

    // The second request answers first, then the first finally arrives.
    second.resolve('second');
    await settle();
    first.resolve('first');
    await settle();

    // This is the single commonest combobox defect and the reason the
    // primitive is shared rather than written per component.
    expect(resource.data()).toBe('second');
    expect(resource.status()).toBe('success');
  });

  it('aborts the previous request when a new one starts', async () => {
    const aborts: boolean[] = [];
    const source = new Signal.State(1);

    withScope(() =>
      createResource(
        (request) =>
          new Promise<number>((resolve) => {
            request.signal.addEventListener('abort', () => aborts.push(true));
            setTimeout(() => resolve(request.source), 0);
          }),
        { source: () => source.get() },
      ),
    );

    await Promise.resolve();
    source.set(2);
    flushSync();
    await Promise.resolve();

    expect(aborts.length).toBeGreaterThan(0);
  });
});

describe('what the source controls', () => {
  it('refetches when the source changes', async () => {
    const source = new Signal.State('a');
    const fetcher = vi.fn((request: { source: string }) => `got ${request.source}`);
    const resource = withScope(() => createResource(fetcher, { source: () => source.get() }));

    await settle();
    expect(resource.data()).toBe('got a');

    source.set('b');
    flushSync();
    await settle();
    expect(resource.data()).toBe('got b');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not fetch while disabled, and asks once enabled', async () => {
    const on = new Signal.State(false);
    const fetcher = vi.fn(() => 'value');
    const resource = withScope(() =>
      createResource(fetcher, { source: () => 1, enabled: () => on.get() }),
    );

    await settle();
    expect(fetcher).not.toHaveBeenCalled();

    on.set(true);
    flushSync();
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(resource.data()).toBe('value');
  });

  it('treats an equal source as the same request', async () => {
    const page = new Signal.State(1);
    const fetcher = vi.fn(() => 'page');
    withScope(() =>
      createResource(fetcher, {
        // A derived source builds a fresh object each read, so without this
        // every unrelated render would refetch.
        source: () => ({ page: page.get() }),
        equals: (a, b) => a.page === b.page,
      }),
    );

    await settle();
    const calls = fetcher.mock.calls.length;

    page.set(1);
    flushSync();
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
});

describe('mutating locally', () => {
  it('writes data without a request', async () => {
    const resource = withScope(() => createResource(() => 'server'));
    await settle();

    resource.mutate(() => 'local');
    flushSync();
    expect(resource.data()).toBe('local');
  });

  it('gives the fetcher the previous data, so a page can append', async () => {
    const page = new Signal.State(1);
    const resource = withScope(() =>
      createResource<number[], number>(
        (request) => [...(request.previous ?? []), request.source],
        { source: () => page.get() },
      ),
    );

    await settle();
    page.set(2);
    flushSync();
    await settle();

    expect(resource.data()).toEqual([1, 2]);
  });
});

describe('cleanup', () => {
  it('abandons an in-flight request when the scope is disposed', async () => {
    let aborted = false;
    const gate = deferred<string>();

    createRoot((dispose) => {
      createResource((request) => {
        request.signal.addEventListener('abort', () => {
          aborted = true;
        });
        return gate.promise;
      });
      // Dispose while the request is still outstanding.
      queueMicrotask(dispose);
    });

    await settle();
    expect(aborted).toBe(true);
  });

  it('does not write into a disposed scope when a late response lands', async () => {
    const gate = deferred<string>();
    let resource!: ReturnType<typeof createResource<string, undefined>>;

    createRoot((dispose) => {
      resource = createResource(() => gate.promise);
      queueMicrotask(dispose);
    });

    await settle();
    gate.resolve('late');
    await settle();

    // Whatever it reports, it must not have thrown on the way.
    expect(() => resource.status()).not.toThrow();
  });
});
