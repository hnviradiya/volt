/**
 * @voltdev/query
 *
 * One cache for server state, keyed by structural query keys.
 *
 * `createResource` in @voltdev/primitives owns one request's lifecycle, which
 * is right for a combobox search and wrong for data two components both want.
 * This is the layer above it: two components asking the same question make one
 * request, cached data is served while it is revalidated behind them, a
 * mutation can invalidate by prefix, a list can grow a page at a time, and the
 * request stops when the last component watching it goes away.
 */

export { hashQueryKey, type QueryKey } from './key.js';

export {
  createQueryClient,
  optimistic,
  provideQueryClient,
  useQueryClient,
  type MutateOptions,
  type OptimisticWrite,
  type Query,
  type QueryClient,
  type QueryClientOptions,
  type QueryContext,
  type QueryEntryOptions,
  type QueryFetcher,
  type QueryFilter,
  type QueryObservation,
  type QueryRetryOptions,
  type QueryStatus,
  type QueryUpdater,
} from './client.js';

export { createQuery, type QueryOptions } from './query.js';

export {
  createInfiniteQuery,
  type InfiniteData,
  type InfinitePageContext,
  type InfiniteQuery,
  type InfiniteQueryOptions,
} from './infinite.js';
