/**
 * Volt's effect system, layered on `Signal.subtle.Watcher`.
 *
 * The Signals proposal deliberately ships no `effect`, because scheduling is a
 * framework concern. Volt schedules in two phases:
 *
 *   - `renderEffect` — DOM patching. Runs immediately on creation so a
 *     template builds synchronously, and flushes before user effects.
 *   - `effect` — user work. Its first run is deferred along with the rest, so
 *     it always observes a settled tree.
 *
 * Updates are coalesced onto a microtask, which means a burst of `.set()`
 * calls repaints once. `flushSync()` drains the queues immediately when you
 * need the DOM up to date on the current turn (tests, measurement).
 *
 * Scopes give Volt the disposal story the proposal has no opinion on: every
 * effect belongs to the scope that created it, so tearing down a component
 * tears down its effects and their cleanups in one call.
 */

import {
  ComputedSignal,
  WatcherNode,
  disposeComputed,
  markEffectComputed,
  untrack,
  type SignalOptions,
} from './graph.js';

export type Dispose = () => void;
export type CleanupFn = () => void;
export type EffectFn = () => void | CleanupFn;

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export interface Scope {
  parent: Scope | null;
  /** Allocated on first child; most scopes never have one. */
  children: Set<Scope> | null;
  /** Allocated on first cleanup; most scopes never register one. */
  cleanups: CleanupFn[] | null;
  contexts: Map<symbol, unknown> | null;
  disposed: boolean;
}

let currentScope: Scope | null = null;

function createScope(parent: Scope | null): Scope {
  const scope: Scope = {
    parent,
    children: null,
    cleanups: null,
    contexts: null,
    disposed: false,
  };
  if (parent) (parent.children ??= new Set()).add(scope);
  return scope;
}

export function getScope(): Scope | null {
  return currentScope;
}

function runInScope<T>(scope: Scope | null, fn: () => T): T {
  const previous = currentScope;
  currentScope = scope;
  try {
    return fn();
  } finally {
    currentScope = previous;
  }
}

export function runWithScope<T>(scope: Scope | null, fn: () => T): T {
  return runInScope(scope, fn);
}

/** Tear down a scope's children and cleanups without disposing the scope. */
function clearScope(scope: Scope): void {
  if (scope.children !== null) {
    // Copied first: disposeScope removes each child from this same set.
    for (const child of [...scope.children]) disposeScope(child);
    scope.children.clear();
  }

  const cleanups = scope.cleanups;
  if (cleanups !== null) {
    // Cleanups run newest-first so teardown mirrors construction order.
    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        cleanups[i]!();
      } catch (err) {
        reportError(err);
      }
    }
    cleanups.length = 0;
  }
}

export function disposeScope(scope: Scope): void {
  if (scope.disposed) return;
  scope.disposed = true;
  clearScope(scope);
  scope.parent?.children?.delete(scope);
  scope.contexts = null;
}

/**
 * Run `fn` in a fresh scope and hand it a disposer. Nothing created inside is
 * released until that disposer is called, which is how Volt keeps a mounted
 * component alive independently of whatever rendered it.
 */
export function createRoot<T>(
  fn: (dispose: Dispose) => T,
  parent: Scope | null = currentScope,
): T {
  const scope = createScope(parent);
  const dispose = () => disposeScope(scope);
  return runInScope(scope, () => untrack(() => fn(dispose)));
}

export function onCleanup(fn: CleanupFn): CleanupFn {
  if (currentScope === null) {
    if (typeof console !== 'undefined') {
      console.warn('[volt] onCleanup called outside a reactive scope — it will never run.');
    }
    return fn;
  }
  (currentScope.cleanups ??= []).push(fn);
  return fn;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T;
}

export function createContext<T>(defaultValue: T, name?: string): Context<T> {
  return { id: Symbol(name ?? 'volt.context'), defaultValue };
}

export function provideContext<T>(context: Context<T>, value: T): void {
  if (!currentScope) {
    throw new Error('[volt] provideContext must be called inside a reactive scope.');
  }
  (currentScope.contexts ??= new Map()).set(context.id, value);
}

export function useContext<T>(context: Context<T>): T {
  let scope = currentScope;
  while (scope) {
    if (scope.contexts?.has(context.id)) return scope.contexts.get(context.id) as T;
    scope = scope.parent;
  }
  return context.defaultValue;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

let scheduled = false;
let flushing = false;
let batchDepth = 0;

const renderWatcher = new WatcherNode(function () {
  schedule();
});

const effectWatcher = new WatcherNode(function () {
  schedule();
});

let pendingResolvers: (() => void)[] = [];

function schedule(): void {
  if (scheduled || flushing || batchDepth > 0) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    flushSync();
  });
}

const MAX_FLUSH_PASSES = 100;

/**
 * Drain both queues now. Render effects settle completely before user effects
 * run, and the loop repeats while effects keep dirtying the graph so the DOM
 * is fully settled when this returns.
 */
export function flushSync(): void {
  // An open batch wins: nothing is allowed to observe a half-applied group,
  // including an explicit flush from inside it.
  if (flushing || batchDepth > 0) return;
  flushing = true;
  scheduled = false;

  try {
    let passes = 0;
    for (;;) {
      const renderPending = renderWatcher.getPending();
      if (renderPending.length > 0) {
        for (const node of renderPending) runEffectComputed(node);
        renderWatcher.watch();
        if (++passes > MAX_FLUSH_PASSES) {
          throw new Error(
            '[volt] Render effects did not settle after ' +
              MAX_FLUSH_PASSES +
              ' passes — a render effect is very likely writing a signal it also reads.',
          );
        }
        continue;
      }

      const effectPending = effectWatcher.getPending();
      if (effectPending.length === 0) break;

      for (const node of effectPending) runEffectComputed(node);
      effectWatcher.watch();

      if (++passes > MAX_FLUSH_PASSES) {
        throw new Error(
          '[volt] Effects did not settle after ' +
            MAX_FLUSH_PASSES +
            ' passes — an effect is very likely writing a signal it also reads.',
        );
      }
    }
  } finally {
    flushing = false;
    const resolvers = pendingResolvers;
    pendingResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}

function runEffectComputed(node: ComputedSignal<unknown>): void {
  try {
    node.get();
  } catch (err) {
    reportError(err);
  }
}

/** Resolves once the DOM reflects every pending change. */
export function tick(): Promise<void> {
  flushSync();
  return new Promise<void>((resolve) => {
    pendingResolvers.push(resolve);
    queueMicrotask(() => {
      if (!flushing) {
        const index = pendingResolvers.indexOf(resolve);
        if (index !== -1) pendingResolvers.splice(index, 1);
        resolve();
      }
    });
  });
}

/**
 * Group writes so nothing flushes until the whole group is applied. Updates
 * already coalesce on a microtask, so this only matters alongside
 * `flushSync()` or when a partially-applied state would be observable.
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) schedule();
  }
}

function reportError(err: unknown): void {
  if (typeof console !== 'undefined') console.error('[volt] Uncaught error in effect:', err);
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

function createEffect(fn: EffectFn, watcher: WatcherNode, immediate: boolean): Dispose {
  const parent = currentScope;
  const scope = createScope(parent);
  let cleanup: CleanupFn | null = null;
  let disposed = false;

  const options: SignalOptions<void> = {
    // An effect must re-run on every notification, never dedupe on its result.
    equals: () => false,
  };

  const computed = new ComputedSignal<void>(function effectBody() {
    // Each run starts from a clean slate: children disposed, cleanups run.
    clearScope(scope);
    if (cleanup) {
      const previous = cleanup;
      cleanup = null;
      try {
        previous();
      } catch (err) {
        reportError(err);
      }
    }
    const result = runInScope(scope, fn);
    if (typeof result === 'function') cleanup = result;
  }, options);

  markEffectComputed(computed as ComputedSignal<unknown>);

  watcher.watch(computed as ComputedSignal<unknown>);

  if (immediate) {
    // Untracked so that creating an effect inside another effect does not make
    // the outer one depend on the inner.
    untrack(() => {
      try {
        computed.get();
      } catch (err) {
        reportError(err);
      }
    });
  } else {
    // A fresh computed is already DIRTY; queueing it means the first run
    // happens in the next flush rather than at creation. That is what lets an
    // effect declared in a class field observe values assigned to the
    // instance afterwards — component props, most importantly — instead of
    // firing once against the field's initial value.
    watcher.pending.add(computed as ComputedSignal<unknown>);
    schedule();
  }

  const dispose: Dispose = () => {
    if (disposed) return;
    disposed = true;
    watcher.unwatch(computed as ComputedSignal<unknown>);
    // Unwatching stops it being scheduled; this detaches it from its sources
    // so they stop retaining and re-marking it.
    disposeComputed(computed as ComputedSignal<unknown>);
    if (cleanup) {
      try {
        cleanup();
      } catch (err) {
        reportError(err);
      }
      cleanup = null;
    }
    disposeScope(scope);
  };

  // Disposing the owning scope disposes its effects.
  if (parent) (parent.cleanups ??= []).push(dispose);
  return dispose;
}

/**
 * A user effect.
 *
 * The first run is deferred to the next flush, so the effect observes a
 * settled tree — and, for an effect declared in a class field, values
 * assigned to the instance after construction.
 */
export function effect(fn: EffectFn): Dispose {
  return createEffect(fn, effectWatcher, false);
}

/**
 * A DOM-patching effect. Runs synchronously on creation, because a template
 * has to produce its nodes before anything can insert them.
 */
export function renderEffect(fn: EffectFn): Dispose {
  return createEffect(fn, renderWatcher, true);
}
