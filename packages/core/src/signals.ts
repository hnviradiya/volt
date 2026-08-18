/**
 * The lowered spelling of the `Signal` namespace, re-exported so that an app
 * depending only on `@voltdev/core` can resolve it.
 *
 * `@voltdev/vite-plugin` emits imports from here for a module that reached the
 * namespace through `@voltdev/core`; under a strict node_modules layout that
 * module cannot see `@voltdev/reactivity` at all. See that package's
 * `signals.ts` for what the lowering is and why.
 */

export * from '@voltdev/reactivity/signals';
