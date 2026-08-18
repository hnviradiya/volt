/**
 * Volt's effect system, layered on `Signal.subtle.Watcher`.
 *
 * The Signals proposal deliberately ships no `effect`, because scheduling is a
 * framework concern. Volt schedules in three phases:
 *
 *   - `renderEffect` — DOM patching. Runs immediately on creation so a
 *     template builds synchronously, and flushes before everything else.
 *   - `measureEffect` — reading geometry, once the DOM has settled and before
 *     anything writes again, so every read in a flush shares one layout.
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
} from './graph.js';

export type Dispose = () => void;
export type CleanupFn = () => void;
export type EffectFn = () => void | CleanupFn;

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export interface Scope {
  parent: Scope | null;
  /**
   * Allocated on first child; most scopes never have one.
   *
   * An array rather than a set: teardown walks the whole list and discards it,
   * which needs no membership test, and hashing every scope on the way out is
   * the bulk of the cost of clearing a large tree.
   */
  children: Scope[] | null;
  /**
   * This scope's index in `parent.children`, or -1 when it has no parent.
   *
   * Kept so a scope can detach itself without searching for its own slot. A
   * keyed list disposes rows one at a time, so a linear search here would make
   * clearing a list quadratic in its length.
   */
  slot: number;
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
    slot: -1,
    cleanups: null,
    contexts: null,
    disposed: false,
  };
  if (parent) {
    const siblings = (parent.children ??= []);
    scope.slot = siblings.length;
    siblings.push(scope);
  }
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
  const children = scope.children;
  if (children !== null) {
    // Children are told not to detach themselves: the whole list is discarded
    // straight after, so each one searching for its own slot would make
    // clearing a large tree quadratic.
    for (let i = children.length - 1; i >= 0; i--) disposeScope(children[i]!, false);
    children.length = 0;
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

export function disposeScope(scope: Scope, detach = true): void {
  if (scope.disposed) return;
  scope.disposed = true;
  clearScope(scope);

  if (detach && scope.parent?.children) {
    const siblings = scope.parent.children;
    const index = scope.slot;
    if (index >= 0 && siblings[index] === scope) {
      // Order between siblings carries no meaning, so the last one fills the
      // hole rather than shifting everything after it — and it is told where
      // it landed, so it can still detach itself in constant time.
      const last = siblings.pop()!;
      if (index < siblings.length) {
        siblings[index] = last;
        last.slot = index;
      }
    }
  }

  scope.slot = -1;
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
    if (__VOLT_DEV__ && typeof console !== 'undefined') {
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

const measureWatcher = new WatcherNode(function () {
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

export interface FlushMetrics {
  /** Flushes that ran at least one effect, since the last reset. */
  flushes: number;
  /** Forced layouts the most recent of those flushes cost. */
  forcedLayouts: number;
  /** The worst any single flush has cost since the last reset. */
  peakForcedLayouts: number;
}

const metrics: FlushMetrics = { flushes: 0, forcedLayouts: 0, peakForcedLayouts: 0 };

/**
 * A snapshot of what the scheduler cost.
 *
 * Layout thrash is invisible until something counts it, and the count is the
 * only way to know the measure lane is still doing its job: one forced layout
 * per flush is healthy, and a component that reads geometry from the wrong
 * phase shows up here as a peak that climbs with the number of components on
 * screen. Tracked in production too — a metric that disappears from the build
 * where performance matters defends nothing.
 *
 * Counted from the phase transitions rather than by instrumenting reads, so a
 * measure drain that follows writes is charged one layout whether or not a
 * callback asked for geometry: an upper bound, and the cheap one.
 */
export function getFlushMetrics(): FlushMetrics {
  return { ...metrics };
}

export function resetFlushMetrics(): void {
  metrics.flushes = 0;
  metrics.forcedLayouts = 0;
  metrics.peakForcedLayouts = 0;
}

function settleError(phase: string): Error {
  return new Error(
    __VOLT_DEV__
      ? '[volt] ' +
        phase +
        ' effects did not settle after ' +
        MAX_FLUSH_PASSES +
        ' passes — one of them is very likely writing a signal it also reads.'
      : '[volt] effects did not settle',
  );
}

/**
 * Drain the queues now, in phase order: render effects settle completely,
 * then measure effects read, then user effects run. Every pass starts again
 * from the top, so a user effect that writes still gets its DOM patched — and
 * anything measuring it re-read — before this returns.
 */
export function flushSync(): void {
  // An open batch wins: nothing is allowed to observe a half-applied group,
  // including an explicit flush from inside it.
  if (flushing || batchDepth > 0) return;
  flushing = true;
  scheduled = false;

  // Whether a read would have to wait for layout. It starts true because
  // whatever caused this flush — an event handler, a bare `.set()` — has
  // already written something the engine has not laid out since.
  let layoutStale = true;
  let forcedLayouts = 0;
  let passes = 0;

  try {
    for (;;) {
      const renderPending = renderWatcher.getPending();
      if (renderPending.length > 0) {
        for (const node of renderPending) runEffectComputed(node);
        renderWatcher.watch();
        layoutStale = true;
        if (++passes > MAX_FLUSH_PASSES) throw settleError('Render');
        continue;
      }

      const measurePending = measureWatcher.getPending();
      if (measurePending.length > 0) {
        // The whole point of the lane: the first read pays for layout and
        // every other read in the drain is then free.
        if (layoutStale) {
          forcedLayouts++;
          layoutStale = false;
        }
        drainMeasure(measurePending);
        measureWatcher.watch();
        if (++passes > MAX_FLUSH_PASSES) throw settleError('Measure');
        continue;
      }

      const effectPending = effectWatcher.getPending();
      if (effectPending.length === 0) break;

      for (const node of effectPending) runEffectComputed(node);
      effectWatcher.watch();
      layoutStale = true;
      if (++passes > MAX_FLUSH_PASSES) throw settleError('User');
    }
  } finally {
    flushing = false;
    // A flush that found nothing to do is not a flush: counting it would
    // overwrite the last real measurement with a zero on the next `tick()`.
    if (passes > 0) {
      metrics.flushes++;
      metrics.forcedLayouts = forcedLayouts;
      if (forcedLayouts > metrics.peakForcedLayouts) metrics.peakForcedLayouts = forcedLayouts;
    }
    const resolvers = pendingResolvers;
    pendingResolvers = [];
    for (const resolve of resolvers) resolve();
  }
}

/**
 * A measure drain, watched in development for writes.
 *
 * The phase is read-only by contract: a write in the middle of it invalidates
 * the layout the drain just paid for, so the next read forces another one and
 * the thrash the lane exists to remove is back, silently, visible only under
 * a profiler. A MutationObserver catches every write path — including
 * `style.top = ...`, which patching individual DOM methods would miss — and
 * costs nothing outside the drain.
 *
 * It is written inline rather than as helpers so the whole diagnostic sits in
 * one `__VOLT_DEV__` branch and a production build drops all of it.
 */
function drainMeasure(pending: ComputedSignal<unknown>[]): void {
  if (!__VOLT_DEV__) {
    for (const node of pending) runEffectComputed(node);
    return;
  }

  if (measureObserver === undefined) {
    measureObserver =
      typeof MutationObserver === 'function' && typeof document !== 'undefined'
        ? // Records are taken synchronously below, so the callback is never
          // left anything to deliver.
          new MutationObserver(() => {})
        : null;
  }
  measureObserver?.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  try {
    for (const node of pending) runEffectComputed(node);
  } finally {
    const records = measureObserver?.takeRecords();
    measureObserver?.disconnect();
    const record = records?.[0];
    if (record && typeof console !== 'undefined') {
      const tag = (record.target as Partial<Element>).nodeName?.toLowerCase() ?? 'node';
      const what =
        record.type === 'attributes'
          ? `${record.attributeName} on <${tag}>`
          : `${record.type} on <${tag}>`;
      console.error(
        `[volt] A measure effect wrote to the DOM (${what}). The measure phase is ` +
          'read-only: a write there dirties the layout the phase just forced, so the ' +
          'next read forces another one. Set a signal instead and let a render ' +
          'effect apply it, or move the write to effect().',
      );
    }
  }
}

let measureObserver: MutationObserver | null | undefined;

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

/**
 * An effect's computed node, which is also its scope.
 *
 * Two objects were allocated per effect: the computed, and a separate scope
 * holding its children and cleanups. Effect construction is what building a
 * list row is made of, so that second object was paid for on every binding of
 * every row. A subclass keeps the scope fields off ordinary computeds, which
 * never need them, while giving effects both roles in one allocation.
 */
class EffectNode extends ComputedSignal<void> implements Scope {
  parent: Scope | null = null;
  children: Scope[] | null = null;
  slot = -1;
  cleanups: CleanupFn[] | null = null;
  contexts: Map<symbol, unknown> | null = null;
  disposed = false;
}

function createEffect(fn: EffectFn, watcher: WatcherNode, immediate: boolean): Dispose {
  const parent = currentScope;
  let cleanup: CleanupFn | null = null;
  let disposed = false;

  // No options object. An effect must re-run on every notification rather than
  // dedupe on its result, which used to be said with `equals: () => false` —
  // three allocations per effect (the object, that arrow, and the wrapper the
  // constructor builds around it) for a comparison that is never reached,
  // because a node marked as an effect skips the equality path entirely. Row
  // creation is dominated by effect construction, so this is not incidental.
  const computed: EffectNode = new EffectNode(function effectBody() {
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
  });

  // The node is its own scope, so nothing else is allocated for one.
  const scope: Scope = computed;
  computed.parent = parent;
  if (parent) {
    const siblings = (parent.children ??= []);
    computed.slot = siblings.length;
    siblings.push(computed);
  }

  markEffectComputed(computed as unknown as ComputedSignal<unknown>);

  watcher.watch(computed as unknown as ComputedSignal<unknown>);

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
    watcher.pending.add(computed as unknown as ComputedSignal<unknown>);
    schedule();
  }

  const dispose: Dispose = () => {
    if (disposed) return;
    disposed = true;
    watcher.unwatch(computed as unknown as ComputedSignal<unknown>);
    // Unwatching stops it being scheduled; this detaches it from its sources
    // so they stop retaining and re-marking it.
    disposeComputed(computed as unknown as ComputedSignal<unknown>);
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

/**
 * A read-only effect, run after the DOM has settled and before any user
 * effect writes to it again.
 *
 * Geometry — `getBoundingClientRect`, `offsetWidth`, `scrollTop` — is only
 * meaningful once rendering has finished, and reading it forces the engine to
 * lay out everything written since the last frame. Read from an `effect` and
 * every component that positions a popover, syncs a scroller or measures
 * overflow forces a layout of its own, turning one flush into write, layout,
 * write, layout, once per component. Read from here and they all share the
 * single layout the phase forces once.
 *
 * Writing a signal from here is the intended way out: the render effect that
 * reads it patches the DOM on the next pass, still ahead of user effects.
 * Writing to the DOM directly is what reinstates the thrash, so in
 * development the drain reports it.
 */
export function measureEffect(fn: EffectFn): Dispose {
  return createEffect(fn, measureWatcher, false);
}
