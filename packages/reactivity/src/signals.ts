/**
 * The `Signal` namespace, flattened into one module export per member.
 *
 * `export namespace Signal` compiles to a runtime object, and an object
 * literal is opaque to a bundler: reaching `Signal.State` retains every other
 * property, so an app that only ever constructs state signals still ships the
 * watcher and the whole introspection surface. Measured on a bundle using
 * nothing but `Signal.State`, that is a few hundred bytes of code no line of
 * the application can reach.
 *
 * These are the same bindings the namespace holds — not copies, not wrappers.
 * `@voltdev/vite-plugin` rewrites `Signal.State` to `State` from here at build
 * time, which is why identity matters: the two spellings must be the same
 * value, so that `instanceof`, `isSignal` and every identity comparison give
 * the same answer whichever path a module took. `test/signals.test.ts` pins
 * that, member by member, against the namespace itself.
 *
 * Nothing here is the API to write by hand. `Signal.State` is the spelling the
 * proposal defines and the one to use; this module exists so the build can
 * spell it differently.
 */

export {
  StateSignal as State,
  ComputedSignal as Computed,
  WatcherNode as Watcher,
  untrack,
  currentComputed,
  introspectSources,
  introspectSinks,
  hasSinks,
  hasSources,
  watched,
  unwatched,
} from './graph.js';
