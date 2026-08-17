/**
 * `createInfiniteQuery` — one entry holding a list that grows a page at a time.
 *
 * A feed, a log, a search that loads more as it is scrolled. All of it is one
 * question — "the rows, from the start" — so it is one cache entry holding
 * every page fetched for it, rather than an entry per page that nothing knows
 * how to invalidate together.
 *
 *   class Feed {
 *     posts = createInfiniteQuery({
 *       key: ['posts'],
 *       initialPageParam: undefined as string | undefined,
 *       fetcher: ({ pageParam, signal }) =>
 *         fetch(`/posts?cursor=${pageParam ?? ''}`, { signal }).then((r) => r.json()),
 *       getNextPageParam: (page) => page.nextCursor,
 *     });
 *   }
 *
 *   <article :for="page of posts.pages()" :key="page.cursor">…</article>
 *   <button :on-click="posts.fetchNextPage()" :disabled="!posts.hasNextPage()">More</button>
 *
 * The pages never leave the screen while the next one loads: they are what the
 * entry holds, and appending to them is a request over data that is already
 * there — the same stale-while-revalidate rule the cache applies everywhere.
 * `keepPreviousData` is the equivalent for the other kind of pagination, where
 * each page is its own key and the last one is held over the gap.
 *
 * The cursor is read from the page that carried it rather than counted, so
 * this is the same shape for `?page=2` and for an opaque cursor — and a
 * refetch re-reads it from the *fresh* page, because a cursor is a position in
 * data the server has since changed.
 */

import { Signal } from '@voltdev/core';
import type { QueryKey } from './key.js';
import {
  useQueryClient,
  type Query,
  type QueryClient,
  type QueryContext,
  type QueryRetryOptions,
} from './client.js';
import { createQuery } from './query.js';

const { untrack } = Signal.subtle;

/** What the entry holds: the pages in order, and the cursor each was asked for with. */
export interface InfiniteData<T, P> {
  readonly pages: readonly T[];
  readonly pageParams: readonly P[];
}

export interface InfinitePageContext<P> extends QueryContext {
  /** Which page this call is for — `initialPageParam`, or what `getNextPageParam` returned. */
  readonly pageParam: P;
}

export interface InfiniteQueryOptions<T, P> extends QueryRetryOptions {
  key: QueryKey | (() => QueryKey);
  fetcher: (context: InfinitePageContext<P>) => T | Promise<T>;
  /** The cursor the first page is asked for with. */
  initialPageParam: P;
  /**
   * The cursor for the page after `lastPage`, or `undefined` when the list ends
   * there — which is also what makes `hasNextPage()` false and the More button
   * go away.
   */
  getNextPageParam: (lastPage: T, pages: readonly T[], lastPageParam: P) => P | undefined;
  /** Which cache. Defaults to the one in scope — see `provideQueryClient`. */
  client?: QueryClient;
  enabled?: () => boolean;
  staleTime?: number;
  gcTime?: number;
}

export interface InfiniteQuery<T, P> extends Query<InfiniteData<T, P>> {
  /** The pages in order. Empty until the first one lands. */
  pages(): readonly T[];
  /** Whether `getNextPageParam` named a page after the last one held. */
  hasNextPage(): boolean;
  /** A page is being appended. `isFetching()` is any request, this one only that. */
  isFetchingNextPage(): boolean;
  /**
   * Ask for the page after the last one and append it. Never rejects — the
   * failure is in `error()`, as with `refetch`.
   *
   * Does nothing at the end of the list, and a second call while one is in
   * flight joins it rather than asking for the same page twice.
   */
  fetchNextPage(): Promise<void>;
}

const EMPTY: InfiniteData<never, never> = { pages: [], pageParams: [] };

export function createInfiniteQuery<T, P>(
  options: InfiniteQueryOptions<T, P>,
): InfiniteQuery<T, P> {
  const client = options.client ?? useQueryClient();

  /** The cursor the request being started right now is appending, or undefined. */
  let appending: P | undefined;
  /** What the request in flight decided on its first attempt, so a retry repeats it. */
  let running: P | undefined;
  const appendingNow = new Signal.State(false);
  let inFlight: Promise<void> | null = null;

  const held = (key: QueryKey): InfiniteData<T, P> =>
    client.getData<InfiniteData<T, P>>(key) ?? EMPTY;

  const fetchPage = (context: QueryContext, pageParam: P): T | Promise<T> =>
    options.fetcher({
      key: context.key,
      signal: context.signal,
      attempt: context.attempt,
      pageParam,
    });

  const appendPage = async (
    context: QueryContext,
    pageParam: P,
  ): Promise<InfiniteData<T, P>> => {
    // Read before the await: the append belongs to the list it was asked for.
    // Anything that lands in between supersedes this request anyway.
    const current = held(context.key);
    const page = await fetchPage(context, pageParam);
    return {
      pages: [...current.pages, page],
      pageParams: [...current.pageParams, pageParam],
    };
  };

  const fetchEveryPage = async (context: QueryContext): Promise<InfiniteData<T, P>> => {
    const current = held(context.key);
    // Every page that is on screen, asked for again in order. A list built from
    // five requests is one list to the person reading it, and refetching only
    // its first page would leave the other four describing a list that moved.
    const wanted = Math.max(1, current.pages.length);
    const pages: T[] = [];
    const pageParams: P[] = [];
    let pageParam: P | undefined = current.pageParams[0] ?? options.initialPageParam;

    while (pageParams.length < wanted && pageParam !== undefined) {
      const page = await fetchPage(context, pageParam);
      pages.push(page);
      pageParams.push(pageParam);
      // The next cursor comes from the page that just landed, never from the
      // one it replaced: a cursor is a position in data the server has already
      // changed, and the old one asks for a window that has moved. A list that
      // has shrunk ends the walk early, which is how pages that are gone go.
      pageParam = options.getNextPageParam(page, pages, pageParam);
    }

    return { pages, pageParams };
  };

  const query = createQuery<InfiniteData<T, P>>({
    key: options.key,
    client,
    enabled: options.enabled,
    staleTime: options.staleTime,
    gcTime: options.gcTime,
    retry: options.retry,
    retryDelay: options.retryDelay,
    shouldRetry: options.shouldRetry,
    fetcher: (context) => {
      // The first attempt decides what this request is and its retries repeat
      // it. Read afresh each time, a retried append would turn into a refetch
      // of the whole list — a page that failed once costs every other page a
      // second request.
      if (context.attempt === 0) running = appending;
      return running === undefined ? fetchEveryPage(context) : appendPage(context, running);
    },
  });

  const nextParam = (): P | undefined => {
    const data = query.data();
    // Nothing to append to yet. The first page is what the query asks for on
    // its own account, so "no pages" is not "one more page available".
    if (!data || data.pages.length === 0) return undefined;
    const last = data.pages.length - 1;
    return options.getNextPageParam(data.pages[last]!, data.pages, data.pageParams[last]!);
  };

  const appendNextPage = async (): Promise<void> => {
    const pageParam = untrack(nextParam);
    if (pageParam === undefined) return;

    appending = pageParam;
    appendingNow.set(true);
    try {
      // The request starts synchronously, so the fetcher that reads `appending`
      // is the one this call made. Cleared immediately after: whatever
      // supersedes it — an invalidation, a refetch — asks for the whole list
      // instead, which is the right answer, since a list being revalidated is
      // not the list this append was computed against.
      const done = query.refetch();
      appending = undefined;
      await done;
    } finally {
      appending = undefined;
      appendingNow.set(false);
    }
  };

  const fetchNextPage = (): Promise<void> => {
    // Two scroll events in one turn ask for one page. Without this the second
    // supersedes the first, and both answer with the same rows.
    inFlight ??= appendNextPage().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return {
    ...query,
    pages: () => query.data()?.pages ?? EMPTY.pages,
    hasNextPage: () => nextParam() !== undefined,
    isFetchingNextPage: () => appendingNow.get(),
    fetchNextPage,
  };
}
