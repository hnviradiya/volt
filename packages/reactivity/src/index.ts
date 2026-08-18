/**
 * @voltdev/reactivity
 *
 * The reactive core is the TC39 Signals proposal, implemented faithfully:
 *
 *   const count = new Signal.State(0);
 *   const doubled = new Signal.Computed(() => count.get() * 2);
 *   count.set(1);
 *   doubled.get(); // 2
 *
 * Volt adds only what the proposal deliberately leaves to frameworks —
 * effects, scheduling, and disposal scopes — all built on
 * `Signal.subtle.Watcher`.
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

/** Any readable signal — `Signal.State` or `Signal.Computed`. */
export type ReadableSignal<T> = { get(): T };

export type { SignalOptions } from './graph.js';
export { isSignal, isWritableSignal } from './graph.js';

// --- Volt's layer on top ---------------------------------------------------

export {
  effect,
  renderEffect,
  measureEffect,
  batch,
  flushSync,
  tick,
  getFlushMetrics,
  resetFlushMetrics,
  createRoot,
  onCleanup,
  getScope,
  runWithScope,
  disposeScope,
  createContext,
  useContext,
  provideContext,
} from './effect.js';

export type { Scope, Context, Dispose, CleanupFn, EffectFn, FlushMetrics } from './effect.js';
