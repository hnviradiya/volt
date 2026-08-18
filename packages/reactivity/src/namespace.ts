/**
 * The `Signal` namespace object, alone in a module of its own.
 *
 * `export namespace` compiles to `var Signal; (function (_Signal) { ... })(...)`
 * — a top-level call, which a bundler must assume does something. Rollup drops
 * it only by dropping the whole module, so while this lived beside `effect`
 * and `batch` in `index.ts` it was retained by every app that used any of
 * them, and `@voltdev/vite-plugin`'s lowering pass bought nothing: measured on
 * `examples/counter`, 73 B of a possible 522 B, with `currentComputed` and the
 * four introspection functions still in the bundle. On its own the module is
 * reachable only through the `Signal` binding, so an app that never names it
 * — which is every app the pass has lowered — leaves it behind.
 *
 * Annotating the call `@__PURE__` looks like the same fix in one line, and is
 * not: it reaches the same bytes by dropping the initialiser and keeping the
 * declaration, so a build where the lowering did not fire — `lowerSignals:
 * false`, a `.js` or `.tsx` app file, any file the pass declined — reaches
 * `new Signal.State(0)` with `Signal` still undefined. Measured: an app doing
 * nothing but that builds to 1,626 B and throws on the first line. Splitting
 * the module is correct under both builds; the annotation is correct under
 * one.
 *
 * The members are the bindings from `./graph.js` themselves, not wrappers, so
 * this spelling and `./signals.js` hand out the same values.
 */

import {
  ComputedSignal,
  StateSignal,
  WatcherNode,
  currentComputed as _currentComputed,
  hasSinks as _hasSinks,
  hasSources as _hasSources,
  introspectSinks as _introspectSinks,
  introspectSources as _introspectSources,
  untrack as _untrack,
  unwatched as _unwatched,
  watched as _watched,
} from './graph.js';

export namespace Signal {
  /** A mutable reactive value. */
  export const State = StateSignal;
  export type State<T> = StateSignal<T>;

  /** A cached derivation. Re-evaluated lazily, only when actually read. */
  export const Computed = ComputedSignal;
  export type Computed<T = unknown> = ComputedSignal<T>;

  /**
   * Lower-level APIs. `subtle` marks operations that are easy to misuse —
   * they expose graph internals or bypass tracking.
   */
  export namespace subtle {
    export const Watcher = WatcherNode;
    export type Watcher = WatcherNode;

    export const untrack = _untrack;
    export const currentComputed = _currentComputed;
    export const introspectSources = _introspectSources;
    export const introspectSinks = _introspectSinks;
    export const hasSinks = _hasSinks;
    export const hasSources = _hasSources;

    export const watched = _watched;
    export const unwatched = _unwatched;
  }
}
